import { mount } from './mount';
import { BarFrame } from '@/extension/bar/BarFrame';

// The website bar iframe must be transparent below the 34px strip (menus expand
// the frame) and match the embedding element's color-scheme ('normal'),
// otherwise Chrome paints an opaque backdrop behind a transparent iframe.
const root = document.documentElement;
root.style.background = 'transparent';
root.style.colorScheme = 'normal';
document.body.style.background = 'transparent';
document.body.style.overflow = 'hidden';

mount(<BarFrame />, { allowFramed: true });
