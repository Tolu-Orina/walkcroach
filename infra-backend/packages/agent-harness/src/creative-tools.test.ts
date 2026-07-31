import { describe, expect, it } from 'vitest';
import { toBedrockTools, getToolKind } from './tools.js';

describe('Phase B creative tools', () => {
  it('exposes generate_creative_brief and render_pptx on chat', () => {
    const names = toBedrockTools('chat').map((t) => t.toolSpec.name);
    expect(names).toContain('generate_creative_brief');
    expect(names).toContain('render_pptx');
    expect(getToolKind('generate_creative_brief')).toBe('server');
    expect(getToolKind('render_pptx')).toBe('server');
  });

  it('keeps creative tools off builder/plan', () => {
    const build = toBedrockTools('build').map((t) => t.toolSpec.name);
    const plan = toBedrockTools('plan').map((t) => t.toolSpec.name);
    expect(build).not.toContain('render_pptx');
    expect(plan).not.toContain('generate_creative_brief');
  });

  it('Phase C: chat includes flyer tools as server tools', () => {
    const names = toBedrockTools('chat').map((t) => t.toolSpec.name);
    expect(names).toContain('generate_flyer_brief');
    expect(names).toContain('render_flyer');
    expect(getToolKind('generate_flyer_brief')).toBe('server');
    expect(getToolKind('render_flyer')).toBe('server');
  });

  it('Phase D: chat includes video studio tools as server tools', () => {
    const names = toBedrockTools('chat').map((t) => t.toolSpec.name);
    expect(names).toContain('generate_video_brief');
    expect(names).toContain('start_video_job');
    expect(getToolKind('generate_video_brief')).toBe('server');
    expect(getToolKind('start_video_job')).toBe('server');
  });
});
