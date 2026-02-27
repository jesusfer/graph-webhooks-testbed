// -- Client-side Router --
// Simple History API router for SPA navigation.

export type Route = 'delegated' | 'app' | 'detail';

interface RouteMatch {
    route: Route;
    /** Present when route === 'detail' */
    notificationId?: string;
}

type RouteHandler = (match: RouteMatch) => void;

let handler: RouteHandler | null = null;

/** Parse the current pathname into a RouteMatch. */
export function matchRoute(pathname: string = location.pathname): RouteMatch {
    const segments = pathname.replace(/^\/+|\/+$/g, '').split('/');

    if (segments[0] === 'app') {
        return { route: 'app' };
    }

    if (segments[0] === 'notifications' && segments[1]) {
        return { route: 'detail', notificationId: decodeURIComponent(segments[1]) };
    }

    // Default — '/' or '/delegated' or anything else
    return { route: 'delegated' };
}

/** Navigate to a path, pushing browser history. */
export function navigate(path: string): void {
    if (path !== location.pathname) {
        history.pushState(null, '', path);
    }
    applyRoute();
}

/** Re-evaluate the current URL and invoke the route handler. */
export function applyRoute(): void {
    if (handler) {
        handler(matchRoute());
    }
}

/** Initialise the router. Call once at startup after DOM is ready. */
export function initRouter(routeHandler: RouteHandler): void {
    handler = routeHandler;

    // Handle back/forward buttons
    window.addEventListener('popstate', () => applyRoute());
}
