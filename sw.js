// Iterate version to cause cache to be purged
const VERSION = '1';
const CACHE_NAME = `mypwa-cache-v${VERSION}`;

// Resources that are likely to get updated a lot
// if not offline, get them from network
const NETWORK_FIRST_RESOURCES = [
    '/dashboard',
    '/news',
]

// Cached resources that match the following strings should not be periodically updated.
// They are assumed to almost never change. So the periodic update should not worry about them.
// Everything else, we try to update on a regular basis.
const DONT_UPDATE_RESOURCES = [
    '/css/style.css',
    '/css/colors/red.css', 
    '/images/logo.png',
    '/js/vendor.js',
    '/js/bootstrap.js',
    '/js/app.js'
];

// Never cache these resources which are useless when offline anyway
// Specifically do not cache log in and log out routes, because we need them to send the request to the server every time
// Do not cache socket-type services
// Do not cache analytics
const NON_CACHABLE_PATTERNS = [
    '/login',
    '/logout',
    'socket.io',
    'google-analytics',
    'googletagmanager',
];

// Static resources to cache initially
// We initially want to cache both network first resources and dont update resources
const INITIAL_CACHED_RESOURCES = NETWORK_FIRST_RESOURCES.concat(DONT_UPDATE_RESOURCES);

// Use the activate event to delete old caches and avoid running out of space.
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.map(name => {
            if (name !== CACHE_NAME) {
                return caches.delete(name);
            }
        }));
    })());
});

// Use the install event to pre-cache all initial resources.
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        cache.addAll(INITIAL_CACHED_RESOURCES);
    })());
});

// On fetch, we have a cache-first strategy for some resources, where we look for resources in the cache first
// and a network-first strategy for other resources (NETWORK_FIRST_RESOURCES)

// The exception to the cache-first strategy is: if periodicSync is not supported, then we go to the network first
// When periodicSync is supported, we just always go to cache and update the cache in the background at intervals.

self.addEventListener('fetch', event => {

    // Don't handle non-cachable patterns
    if(NON_CACHABLE_PATTERNS.some(pattern => event.request.url.includes(pattern)))
        return;

    const is_network_first_resource = NETWORK_FIRST_RESOURCES.some(pattern => event.request.url.includes(pattern));

    const goNetworkFirst = event.request.url === registration.scope || is_network_first_resource;

    event.respondWith((async () => {

        // The cache: mypwa-cache-v${VERSION}
        const cache = await caches.open(CACHE_NAME);

        // Try to match the request in the cache first.
        const cachedResponse = await cache.match(event.request);

        if (cachedResponse !== undefined && !goNetworkFirst) {

            // Cache hit, send the cached resource.
            return cachedResponse;

        } else {

            // Nothing in cache, or we were told to go network first, go to the network.
            
            try {

                const fetchResponse = await fetch(event.request);

                // Save the new resource in the cache (responses are streams, so we need to clone in order to use it here).
                cache.put(event.request, fetchResponse.clone());

                // And return it.
                return fetchResponse;

            } catch (e) {

                // Fetching didn't work - Attempt to return the cached resource instead
                if(cachedResponse !== undefined)
                    return cachedResponse;

                // Otherwise go to the error page.
                switch(event.request.mode){

                    case 'navigate':
                        const errorResponse = await cache.match('/offline/');
                        return errorResponse;

                        break;

                    case 'cors':
                        // nothing yet
                        break;

                }
            }
        }
    })());

});

// Clean all cache keys
async function cleanCache(){
    const names = await caches.keys();
    await Promise.all(names.map(name => {
        return caches.delete(name);
    }));
}

//  Listen to Message event (sent from the frontend)
self.addEventListener('message', function(event) {
    
    switch(event.data){

        case 'clean_cache': 
            cleanCache();
            break;

    }
        

}, false);


// Listen the periodic background sync events to update the cached resources.
self.addEventListener('periodicsync', event => {
    if (event.tag === 'update-cached-content') {
        event.waitUntil(updateCachedContent());
    }
});

async function updateCachedContent() {

    const requests = await findCacheEntriesToBeRefreshed();
    const cache = await caches.open(CACHE_NAME);

    for (const request of requests) {
        try {
            // Fetch the new version.
            const fetchResponse = await fetch(request);
            // Refresh the cache.
            await cache.put(request, fetchResponse.clone());
        } catch (e) {
            // Fail silently, we'll just keep whatever we already had in the cache.
        }
    }

}

// Find the entries that are already cached and that we want to periodically update.
// In other words, find entries which are not in the DONT_UPDATE_RESOURCES array, which are some resources we never want to bother with updating.
// They can always be force-updated by updating the CACHE version.
async function findCacheEntriesToBeRefreshed() {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();

    return requests.filter(request => {
        // Return false if some of the DONT_UPDATE_RESOURCES array elements (patterns) match the request.url
        return !DONT_UPDATE_RESOURCES.some(pattern => request.url.includes(pattern));
    });
}