import { mountApp } from './ui/app';

const { editor } = mountApp(document.getElementById('app')!);

// Test hook: open the page with ?debug to inspect the editor from the console or browser tests.
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __editor: unknown }).__editor = editor;
}
