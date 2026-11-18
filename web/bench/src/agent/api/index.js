// agent/api/index.js — the host API: every namespace's table in one API
// (core/api.js). The shell adds the panel calls (ui.panel, ui.ask, …) at
// boot with API.add.
//
// Public API: API.
import { AGENTS } from './agents.js';
import { APP } from './app.js';
import { FILES } from './files.js';
import { FRAMES } from './frames.js';
import { LIB } from './lib.js';
import { SESSION } from './session.js';
import { TESTS } from './tests.js';
import { TX } from './tx.js';
import { TYPES } from './types.js';
import { UI } from './ui.js';
import { defineAPI } from '../../core/api.js';

export const API = defineAPI(FILES, APP, FRAMES, TESTS, SESSION, UI, LIB, TX, AGENTS, TYPES)
