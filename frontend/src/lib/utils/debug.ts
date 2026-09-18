const isDev = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.DEV : process.env.NODE_ENV !== 'production';

export const debug = {
    log: (...args: unknown[]) => {
        if (isDev) console.log('[Rokuyomu]', ...args);
    },

    warn: (...args: unknown[]) => {
        if (isDev) console.warn('[Rokuyomu]', ...args);
    },

    error: (...args: unknown[]) => {
        if (isDev) console.error('[Rokuyomu]', ...args);
    },

    info: (...args: unknown[]) => {
        if (isDev) console.info('[Rokuyomu]', ...args);
    },

    table: (data: unknown) => {
        if (isDev) console.table(data);
    }
};

export default debug;