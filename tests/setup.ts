import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { installWebLocksShim } from './webLocksShim';
import { setAdapter } from '@/storage/store';
import { createMemoryAdapter } from '@/storage/adapter';

// Every test starts with an empty in-memory store.
beforeEach(() => {
  setAdapter(createMemoryAdapter());
});

// jsdom has no Web Locks API; real extension pages and the service worker do.
installWebLocksShim();
