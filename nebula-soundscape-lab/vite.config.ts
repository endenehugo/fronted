import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯前端静态站点：构建产物可直接部署到 Qoder Sites / 任意静态托管
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    open: false,
    watch: {
      // Windows 上编辑器/工具的原子写会在源目录生成 `.xxx.tmpdir` 临时目录，
      // chokidar 去监听里面被占用的临时文件会直接 EBUSY 把 dev server 搞崩，这里排除掉
      ignored: ['**/*.tmpdir/**', '**/*.tmpdir', '**/.*.tmp'],
    },
  },
});
