import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const frontendPort = parseInt(env.VITE_PORT || '5173', 10);
    const apiPort = parseInt(env.PORT || '3001', 10);

    return {
        server: {
            port: frontendPort,
            strictPort: true, // Fail clearly if the port is taken, rather than silently incrementing
            proxy: {
                // Proxy /api calls so the frontend doesn't need to know the backend port at all
                '/api': {
                    target: `http://localhost:${apiPort}`,
                    changeOrigin: true,
                }
            }
        },
        preview: {
            port: frontendPort,
            strictPort: true,
        }
    };
});
