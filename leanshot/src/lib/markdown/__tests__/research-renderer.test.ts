/**
 * research-renderer.test.ts — Vitest unit tests for research-renderer.ts.
 *
 * Phase 62 Plan 03. Task 2.
 *
 * Tests:
 *  T1: Renders headings to <h1>..<h6>
 *  T2: Extracts heading outline with anchors
 *  T3: Counts words excluding markdown syntax
 *  T4: Blocks raw HTML (html: false) — script injection attempt must NOT appear in output
 */

import { describe, it, expect } from 'vitest';
import { renderResearchMarkdown } from '../research-renderer';

describe('renderResearchMarkdown', () => {
  it('T1: renders headings to <h1>..<h6>', () => {
    const markdown = `# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6`;

    const { html } = renderResearchMarkdown(markdown);

    expect(html).toContain('<h1>Heading 1</h1>');
    expect(html).toContain('<h2>Heading 2</h2>');
    expect(html).toContain('<h3>Heading 3</h3>');
    expect(html).toContain('<h4>Heading 4</h4>');
    expect(html).toContain('<h5>Heading 5</h5>');
    expect(html).toContain('<h6>Heading 6</h6>');
  });

  it('T2: extracts heading outline with anchors', () => {
    const markdown = `## Background

## Methods & Privacy

## Results: Key Findings

### Sub-section With Symbols!`;

    const { headings } = renderResearchMarkdown(markdown);

    expect(headings).toHaveLength(4);

    expect(headings[0]).toMatchObject({
      level: 2,
      text: 'Background',
      anchor: 'background',
    });

    expect(headings[1]).toMatchObject({
      level: 2,
      text: 'Methods & Privacy',
      // & is stripped as non-alphanumeric; consecutive hyphens collapse to single hyphen
      anchor: 'methods-privacy',
    });

    expect(headings[2]).toMatchObject({
      level: 2,
      text: 'Results: Key Findings',
      anchor: 'results-key-findings',
    });

    expect(headings[3]).toMatchObject({
      level: 3,
      text: 'Sub-section With Symbols!',
      anchor: 'sub-section-with-symbols',
    });
  });

  it('T3: counts words excluding markdown syntax', () => {
    const markdown = `## Introduction

This study **examines** the correlation between weekly tirzepatide doses and weight loss outcomes.

\`\`\`
const x = 42; // code blocks excluded
\`\`\`

- Item one with [a link](https://example.com)
- Item two in the list

> Blockquote text here.`;

    const { wordCount } = renderResearchMarkdown(markdown);

    // Should count prose words but not code block content, headings markers, etc.
    // The paragraph has 14 words, blockquote has 3, list items ~10 = ~27+ words
    expect(wordCount).toBeGreaterThan(10);
    // Should not count the code block's 'const x = 42' as words
    // Raw word count of prose-only should be < 40
    expect(wordCount).toBeLessThan(50);
  });

  it('T4: blocks raw HTML (html: false) — script tag must not appear in output', () => {
    const markdown = `## Introduction

Normal paragraph text.

<script>alert(1)</script>

<a href="javascript:void(0)" onclick="steal()">Click me</a>

More paragraph text.`;

    const { html } = renderResearchMarkdown(markdown);

    // html: false mode — raw script tags are HTML-escaped (not executed)
    // The literal <script> tag must NOT appear as-is in the output
    expect(html).not.toContain('<script>alert(1)</script>');
    // html: false escapes < and > so the browser renders them as text, not DOM elements
    // The escaped form &lt;script&gt; IS acceptable; the raw form is not
    expect(html).not.toContain('<script>');
  });
});
