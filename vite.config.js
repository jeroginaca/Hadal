import { defineConfig } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';

// Dev-only: POST /__shot?name=x with a data URL body saves a canvas frame to
// disk (used for visual checks when the preview tab is throttled).
const SHOT_DIR = process.env.HADAL_SHOTS || '.shots';
const shots = {
  name: 'hadal-shots',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const name = new URL(req.url, 'http://x').searchParams.get('name') || 'shot';
        mkdirSync(SHOT_DIR, { recursive: true });
        writeFileSync(`${SHOT_DIR}/${name}.jpg`, Buffer.from(body.split(',')[1], 'base64'));
        res.end('ok');
      });
    });
  },
};

export default defineConfig({
  base: './', // works from any sub-path (GitHub Pages serves /Hadal/)
  plugins: [shots],
  build: { chunkSizeWarningLimit: 750 }, // three.js core is most of it
});
