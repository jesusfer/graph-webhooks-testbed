// src/types/express-history-api-fallback.d.ts
declare module 'express-history-api-fallback' {
    import { RequestHandler } from 'express';

    interface HistoryApiFallbackOptions {
        maxAge?: number;
        root?: string;
        lastModified?: boolean;
        headers?: Record<string, string>;
        dotfiles?: 'allow' | 'deny' | 'ignore';
    }

    function historyApiFallback(
        indexFile: string,
        options?: HistoryApiFallbackOptions,
    ): RequestHandler;

    export = historyApiFallback;
}
