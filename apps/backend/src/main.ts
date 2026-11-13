import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { setupApp } from './setup-app.js';

// Hard-coded until the Zod-validated config module exists (task 1.2).
const PORT = 3001;

const app = await NestFactory.create(AppModule);
setupApp(app);
await app.listen(PORT);
