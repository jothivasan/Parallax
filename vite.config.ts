import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import {defineConfig, Plugin} from 'vite';

const PYODIDE_RUNTIME_FILES = new Map<string, string>([
  ['pyodide.mjs', 'application/javascript; charset=utf-8'],
  ['pyodide.mjs.map', 'application/json; charset=utf-8'],
  ['pyodide.js', 'application/javascript; charset=utf-8'],
  ['pyodide.asm.js', 'application/javascript; charset=utf-8'],
  ['pyodide.asm.wasm', 'application/wasm'],
  ['python_stdlib.zip', 'application/zip'],
  ['pyodide-lock.json', 'application/json; charset=utf-8'],
]);

function pyodideAssetsPlugin(): Plugin {
  const pyodidePkgDir = path.resolve(__dirname, 'node_modules/pyodide');
  let resolvedOutDir = path.resolve(__dirname, 'dist');

  return {
    name: 'dryrun-self-hosted-pyodide',
    configResolved(config) {
      resolvedOutDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/pyodide', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          next();
          return;
        }
        const cleanUrl = (req.url || '/').split('?')[0].replace(/^\/+/, '');
        const contentType = PYODIDE_RUNTIME_FILES.get(cleanUrl);
        if (!contentType) {
          next();
          return;
        }
        const assetPath = path.join(pyodidePkgDir, cleanUrl);
        if (!fs.existsSync(assetPath)) {
          res.statusCode = 404;
          res.end('Pyodide asset not found');
          return;
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        if (req.method === 'HEAD') {
          const stat = fs.statSync(assetPath);
          res.setHeader('Content-Length', String(stat.size));
          res.statusCode = 200;
          res.end();
          return;
        }
        fs.createReadStream(assetPath).pipe(res);
      });
    },
    writeBundle() {
      const targetDir = path.join(resolvedOutDir, 'pyodide');
      fs.mkdirSync(targetDir, {recursive: true});
      const prodFiles = [
        'pyodide.mjs',
        'pyodide.asm.js',
        'pyodide.asm.wasm',
        'python_stdlib.zip',
        'pyodide-lock.json',
      ];
      for (const fileName of prodFiles) {
        const src = path.join(pyodidePkgDir, fileName);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(targetDir, fileName));
        }
      }
    },
  };
}

const C_TOOLCHAIN_RUNTIME_FILES = new Map<string, string>([
  ['bundle.js', 'application/javascript; charset=utf-8'],
  ['llvm.core.wasm', 'application/wasm'],
  ['llvm.core2.wasm', 'application/wasm'],
  ['llvm.core3.wasm', 'application/wasm'],
  ['llvm.core4.wasm', 'application/wasm'],
  ['llvm-resources.tar', 'application/x-tar'],
]);

function cToolchainAssetsPlugin(): Plugin {
  const clangGenDir = path.resolve(__dirname, 'node_modules/@yowasp/clang/gen');
  let resolvedOutDir = path.resolve(__dirname, 'dist');

  return {
    name: 'dryrun-self-hosted-c-toolchain',
    configResolved(config) {
      resolvedOutDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/c-toolchain', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          next();
          return;
        }
        const cleanUrl = (req.url || '/').split('?')[0].replace(/^\/+/, '');
        const contentType = C_TOOLCHAIN_RUNTIME_FILES.get(cleanUrl);
        if (!contentType) {
          next();
          return;
        }
        const assetPath = path.join(clangGenDir, cleanUrl);
        if (!fs.existsSync(assetPath)) {
          res.statusCode = 404;
          res.end('C toolchain asset not found');
          return;
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        if (req.method === 'HEAD') {
          const stat = fs.statSync(assetPath);
          res.setHeader('Content-Length', String(stat.size));
          res.statusCode = 200;
          res.end();
          return;
        }
        fs.createReadStream(assetPath).pipe(res);
      });
    },
    writeBundle() {
      const targetDir = path.join(resolvedOutDir, 'c-toolchain');
      fs.mkdirSync(targetDir, {recursive: true});
      for (const fileName of C_TOOLCHAIN_RUNTIME_FILES.keys()) {
        const src = path.join(clangGenDir, fileName);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(targetDir, fileName));
        }
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), pyodideAssetsPlugin(), cToolchainAssetsPlugin()],
    optimizeDeps: {
      exclude: ['pyodide', '@yowasp/clang'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
