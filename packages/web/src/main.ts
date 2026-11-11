// Entry: mount the shell, start the router

// shell.css first: it held app.css's leading rules before the split, so this
// order keeps the cascade the rules were written against.
import './css/shell.css';
import './css/app.css';
import { mountShell } from './ui/shell.js';
import { startRouter, navigate } from './router.js';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

const shell = mountShell(root, navigate);
shell.setFooter('ruoka', 'spoilage-first');
startRouter(shell.content);
