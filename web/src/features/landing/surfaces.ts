import type { SurfaceCard } from './SurfacePairSection';
import {
  desktopDownloadHref,
  desktopDownloadIsExternal,
} from './desktopDownload';

const desktopHref = desktopDownloadHref();
const desktopExternal = desktopDownloadIsExternal();

export const SURFACE_PAIRS: {
  id: string;
  eyebrow: string;
  title: string;
  support: string;
  surfaces: [SurfaceCard, SurfaceCard];
}[] = [
  {
    id: 'pair-web-extension',
    eyebrow: 'Create & capture',
    title: 'Build on the web. Remember from the browser.',
    support:
      'App Builder and Chat run in WalkCroach Web. The Browser Extension saves page context into the same memory graph.',
    surfaces: [
      {
        id: 'web',
        name: 'Web',
        blurb:
          'Chat, Projects, and App Builder — plan, preview, and ship with standing project memory.',
        image: '/marketing/surface-web.png',
        imageAlt: 'WalkCroach Web app builder and chat workspace',
        href: '/signup',
        cta: 'Open Web',
      },
      {
        id: 'extension',
        name: 'Browser Extension',
        blurb:
          'MV3 side panel that captures what you are reading and links it to your WalkCroach account.',
        image: '/marketing/surface-chrome.png',
        imageAlt: 'WalkCroach Browser Extension side panel',
        href: '/connect/chrome',
        cta: 'Connect Extension',
      },
    ],
  },
  {
    id: 'pair-ide-cli',
    eyebrow: 'Code where you work',
    title: 'Stay in the editor — or the terminal.',
    support:
      'IDE Extension and CLI share the same authenticated memory and connect flows as Web, without leaving your toolchain.',
    surfaces: [
      {
        id: 'ide',
        name: 'IDE Extension',
        blurb:
          'VS Code and Cursor extension with PKCE connect — continue from Web without pasting tokens.',
        image: '/marketing/surface-ide.png',
        imageAlt: 'WalkCroach IDE Extension in the editor',
        href: '/connect/ide',
        cta: 'Connect IDE Extension',
      },
      {
        id: 'cli',
        name: 'CLI',
        blurb:
          'Terminal workflow for prompts and deploys. Sign in through Web, then work from the shell.',
        image: '/marketing/surface-cli.png',
        imageAlt: 'WalkCroach CLI terminal experience',
        href: '/connect/cli',
        cta: 'Connect CLI',
      },
    ],
  },
  {
    id: 'pair-desktop-sdk',
    eyebrow: 'Long sessions & builders',
    title: 'Desktop IDE depth. SDK reach.',
    support:
      'Desktop IDE hosts long-running agent sessions. The SDK exposes the same memory layer to your own products.',
    surfaces: [
      {
        id: 'desktop',
        name: 'Desktop IDE',
        blurb:
          'Native shell for extended builder sessions — same memory graph, local-first agent host. Windows preview builds are unsigned.',
        image: '/marketing/surface-desktop.png',
        imageAlt: 'WalkCroach Desktop IDE workspace',
        href: desktopHref,
        cta: 'Download Desktop IDE',
        external: desktopExternal,
      },
      {
        id: 'sdk',
        name: 'SDK',
        blurb:
          'Typed client for memory, keys, and health — mint keys in Developer and call the shared graph.',
        image: '/marketing/surface-sdk.png',
        imageAlt: 'WalkCroach SDK and API modules',
        href: '/app/developer',
        cta: 'Open Developer',
      },
    ],
  },
];
