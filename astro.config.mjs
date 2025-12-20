// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify/functions';

// https://astro.build/config
export default defineConfig({
    output: 'server',
    adapter: netlify(),
    security: {
        checkOrigin: false
    },
    vite: {
        server: {
            allowedHosts: [
                'undeliberatively-unblindfolded-latrisha.ngrok-free.dev',
                '.ngrok-free.dev' // Allow all ngrok-free.dev subdomains
            ]
        }
    }
});
