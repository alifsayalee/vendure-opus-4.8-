import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        // SWC is required to support the decorators used in Vendure plugins/services.
        // See https://github.com/vitest-dev/vitest/issues/708#issuecomment-1118628479
        swc.vite(),
    ],
    test: {
        // Only run the co-located unit specs in the example plugins; the
        // dev-server itself is exercised via the e2e suites.
        include: ['example-plugins/**/*.spec.ts'],
    },
});
