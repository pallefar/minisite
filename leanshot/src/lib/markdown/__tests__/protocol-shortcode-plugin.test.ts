/**
 * Phase 61 Plan 07 Task 2 — Unit tests for parseProtocolShortcodes.
 */
import { describe, expect, it } from 'vitest';
import { parseProtocolShortcodes } from '@/lib/markdown/protocol-shortcode-plugin';

const UUID_1 = '00000000-0000-0000-0000-000000000061';
const UUID_2 = '00000000-0000-0000-0000-000000000062';

describe('parseProtocolShortcodes', () => {
  it('Test 1: text with no shortcode → single text segment, empty protocols array', () => {
    const result = parseProtocolShortcodes('Just some plain text with no shortcode.');
    expect(result.protocols).toHaveLength(0);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toEqual({ type: 'text', value: 'Just some plain text with no shortcode.' });
  });

  it('Test 2: text with one shortcode → 3 segments (text, protocol, text), protocols length 1, refIndex=1', () => {
    const text = `Intro text. [protocol:${UUID_1}] Trailing text.`;
    const result = parseProtocolShortcodes(text);
    expect(result.protocols).toHaveLength(1);
    expect(result.protocols[0]).toEqual({ protocolId: UUID_1, refIndex: 1 });
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toEqual({ type: 'text', value: 'Intro text. ' });
    expect(result.segments[1]).toEqual({ type: 'protocol', protocolId: UUID_1, refIndex: 1 });
    expect(result.segments[2]).toEqual({ type: 'text', value: ' Trailing text.' });
  });

  it('Test 3: same shortcode TWICE → 5 segments, protocols length 1 (deduplicated), both protocol segments have refIndex=1', () => {
    const text = `A [protocol:${UUID_1}] B [protocol:${UUID_1}] C`;
    const result = parseProtocolShortcodes(text);
    expect(result.protocols).toHaveLength(1);
    expect(result.protocols[0]).toEqual({ protocolId: UUID_1, refIndex: 1 });
    expect(result.segments).toHaveLength(5);
    const protocolSegments = result.segments.filter((s) => s.type === 'protocol');
    expect(protocolSegments).toHaveLength(2);
    for (const seg of protocolSegments) {
      expect(seg).toEqual({ type: 'protocol', protocolId: UUID_1, refIndex: 1 });
    }
  });

  it('Test 4: two DIFFERENT shortcodes → protocols length 2, refIndex 1 and 2', () => {
    const text = `[protocol:${UUID_1}] and [protocol:${UUID_2}]`;
    const result = parseProtocolShortcodes(text);
    expect(result.protocols).toHaveLength(2);
    expect(result.protocols[0]).toEqual({ protocolId: UUID_1, refIndex: 1 });
    expect(result.protocols[1]).toEqual({ protocolId: UUID_2, refIndex: 2 });
    const protocolSegments = result.segments.filter((s) => s.type === 'protocol');
    expect(protocolSegments).toHaveLength(2);
    expect(protocolSegments[0]).toEqual({ type: 'protocol', protocolId: UUID_1, refIndex: 1 });
    expect(protocolSegments[1]).toEqual({ type: 'protocol', protocolId: UUID_2, refIndex: 2 });
  });

  it('Test 5: malformed shortcode [protocol:not-a-uuid] → treated as plain text, segments length 1, protocols length 0', () => {
    const result = parseProtocolShortcodes('See [protocol:not-a-uuid] here.');
    expect(result.protocols).toHaveLength(0);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.type).toBe('text');
    expect((result.segments[0] as { type: 'text'; value: string }).value).toContain('[protocol:not-a-uuid]');
  });
});
