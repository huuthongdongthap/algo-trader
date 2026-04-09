/**
 * Relationship Graph Builder Tests
 * Tests JSON parsing and relationship extraction from LLM responses
 */

import { describe, it, expect } from 'vitest';
import { extractJsonArray } from '../relationship-graph-builder';

describe('Relationship Graph Builder', () => {
  describe('extractJsonArray', () => {
    it('should parse plain JSON array', () => {
      const input = `[
        {"marketA": "m1", "marketB": "m2", "type": "CAUSAL", "confidence": 0.8, "reasoning": "direct link"}
      ]`;

      const result = extractJsonArray(input);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });

    it('should extract array from markdown code fences', () => {
      const input = `\`\`\`json
        [{"marketA": "m1", "marketB": "m2", "type": "CAUSAL", "confidence": 0.8, "reasoning": "link"}]
      \`\`\``;

      const result = extractJsonArray(input);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });

    it('should extract from code fences without json lang tag', () => {
      const input = `\`\`\`
        [{"marketA": "m1", "marketB": "m2", "type": "CAUSAL", "confidence": 0.8, "reasoning": "link"}]
      \`\`\``;

      const result = extractJsonArray(input);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });

    it('should unwrap relationships object', () => {
      const input = `{"relationships": [{"marketA": "m1", "marketB": "m2", "type": "CAUSAL", "confidence": 0.8, "reasoning": "link"}]}`;

      const result = extractJsonArray(input);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });

    it('should handle multiple relationships', () => {
      const input = `[
        {"marketA": "m1", "marketB": "m2", "type": "CAUSAL", "confidence": 0.8, "reasoning": "a"},
        {"marketA": "m2", "marketB": "m3", "type": "CORRELATED", "confidence": 0.7, "reasoning": "b"},
        {"marketA": "m1", "marketB": "m3", "type": "MUTUAL_EXCLUSION", "confidence": 0.9, "reasoning": "c"}
      ]`;

      const result = extractJsonArray(input);

      expect(result.length).toBe(3);
    });

    it('should return empty array for invalid JSON', () => {
      const input = 'not json at all';

      const result = extractJsonArray(input);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should handle mixed content with code fences', () => {
      const input = `
        Here are the market relationships:
        \`\`\`json
        [
          {"marketA": "trump", "marketB": "harris", "type": "MUTUAL_EXCLUSION", "confidence": 0.95, "reasoning": "exclusive outcomes"}
        ]
        \`\`\`
        These are the only relationships found.
      `;

      const result = extractJsonArray(input);

      expect(result.length).toBe(1);
      expect((result[0] as Record<string, unknown>).marketA).toBe('trump');
    });

    it('should handle whitespace variations', () => {
      const input = `[
  {
    "marketA"  :  "m1"  ,
    "marketB"  :  "m2"  ,
    "type"     :  "CAUSAL"  ,
    "confidence"  :  0.8  ,
    "reasoning"  :  "link"
  }
]`;

      const result = extractJsonArray(input);

      expect(result.length).toBe(1);
    });

    it('should extract from first valid JSON array', () => {
      const input = `Some text [invalid json here

      [{"marketA": "m1", "marketB": "m2", "type": "CAUSAL", "confidence": 0.8, "reasoning": "link"}]

      more text`;

      const result = extractJsonArray(input);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle nested code fences', () => {
      const input = `\`\`\`json
[{"marketA": "m1", "marketB": "m2", "type": "CAUSAL", "confidence": 0.8, "reasoning": "{\\"nested\\": \\"json\\"}"}]
\`\`\``;

      const result = extractJsonArray(input);

      expect(result.length).toBe(1);
    });
  });

});

