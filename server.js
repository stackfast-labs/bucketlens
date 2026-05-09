import { createServer } from './src/server.js';

const { app, config } = createServer();
app.listen(config.port, () => console.log(`${config.appTitle} listening on :${config.port}`));
