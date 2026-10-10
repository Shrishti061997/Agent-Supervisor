import {readFileSync,writeFileSync} from 'node:fs';
import UI from '../worker/ui.js';
const source=readFileSync(new URL('../worker/server.js',import.meta.url),'utf8');
writeFileSync(new URL('../worker/index.js',import.meta.url),source.replace("import UI from './ui.js';",'const UI = '+JSON.stringify(UI)+';'));
