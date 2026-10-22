import { describe, expect, it } from 'vitest';
import { asUrl, resolveSearch } from '@/extension/newtab/search';

describe('New Tab search', () => {
  it('navigates to URLs and bare domains', () => {
    expect(resolveSearch('https://github.com/x', 'google')).toBe('https://github.com/x');
    expect(resolveSearch('github.com', 'google')).toBe('https://github.com/');
    expect(resolveSearch('docs.google.com/a?b=1', 'bing')).toBe('https://docs.google.com/a?b=1');
    expect(resolveSearch('localhost:5173', 'google')).toBe('http://localhost:5173/');
  });

  it('never navigates to non-http(s) schemes', () => {
    expect(asUrl('javascript:alert(1)')).toBeNull();
    expect(asUrl('data:text/html,hi')).toBeNull();
    expect(asUrl('file:///etc/passwd')).toBeNull();
    expect(asUrl('chrome://settings')).toBeNull();
    expect(resolveSearch('javascript:alert(1)', 'google')).toBe('https://www.google.com/search?q=javascript%3Aalert(1)');
  });

  it('searches plain text with the configured engine (encoded)', () => {
    expect(resolveSearch('roblox mechanics & tips', 'duckduckgo')).toBe('https://duckduckgo.com/?q=roblox%20mechanics%20%26%20tips');
    expect(resolveSearch('hello', 'bing')).toBe('https://www.bing.com/search?q=hello');
    expect(resolveSearch('version 1.2', 'google')).toBe('https://www.google.com/search?q=version%201.2');
    expect(resolveSearch('   ', 'google')).toBeNull();
  });
});
