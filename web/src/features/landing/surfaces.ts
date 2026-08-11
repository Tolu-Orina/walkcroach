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
    eyebrow: 'Coding agents',
    title: 'You steer. We explore, act, and verify.',
    support:
      'IDE Extension and CLI are local coding agents (BYOK) that share the same project memory — amplify your craft, don’t replace your editor.',
    surfaces: [
      {
        id: 'ide',
        name: 'IDE Extension',
        blurb:
          'VS Code and Cursor extension with approvals, project link, and recall from Chrome or Web.',
        image: '/marketing/surface-ide.png',
        imageAlt: 'WalkCroach IDE Extension in the editor',
        href: '/connect/ide',
        cta: 'Connect IDE Extension',
      },
      {
        id: 'cli',
        name: 'CLI',
        blurb:
          'Same agent engine in the terminal — approvals before writes, scriptable for CI.',
        image: '/marketing/surface-cli.png',
        imageAlt: 'WalkCroach CLI terminal experience',
        href: '/connect/cli',
        cta: 'Connect CLI',
      },
    ],
  },
  {
    id: 'pair-desktop-sdk',
    eyebrow: 'Desktop depth · platform SDK',
    title: 'Code locally. Expose memory to your agents.',
    support:
      'Desktop IDE runs long coding sessions on the private agent engine. The public SDK is the memory layer for your own products — not a hosted coding loop.',
    surfaces: [
      {
        id: 'desktop',
        name: 'Desktop IDE',
        blurb:
          'Native coding agent host — same memory graph, local-first. Windows preview builds are unsigned.',
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
          'Typed memory, keys, and health client — mint keys in Developer and call the shared graph from your code.',
        image: '/marketing/surface-sdk.png',
        imageAlt: 'WalkCroach SDK and API modules',
        href: '/app/developer',
        cta: 'Open Developer',
      },
    ],
  },
];
