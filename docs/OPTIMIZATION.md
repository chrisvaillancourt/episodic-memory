# Episodic Memory Plugin - Token Consumption Optimization

## Current State

The episodic-memory plugin currently consumes **1.5k tokens** at session start:

- `mcp__plugin_episodic-memory_episodic-memory__search`: **847 tokens**
- `mcp__plugin_episodic-memory_episodic-memory__read`: **671 tokens**

This represents **~2.1%** of the total context budget (200k tokens) and **~44%** of all MCP tool overhead.

## Analysis

### Tool Definitions

The MCP server exposes two tools with the following characteristics:

#### Search Tool (847 tokens)
```javascript
{
  name: "search",
  description: "Gives you memory across sessions. You don't automatically remember past conversations - this tool restores context by searching them. Use BEFORE every task to recover decisions, solutions, and avoid reinventing work. Single string for semantic search or array of 2-5 concepts for precise AND matching. Returns ranked results with project, date, snippets, and file paths.",
  inputSchema: { /* Complex schema with 6 properties */ },
  annotations: { /* 5 metadata fields */ }
}
```

**Token breakdown estimate**:
- Description: ~340 characters = ~85 tokens
- Input schema (6 properties): ~500 tokens
- Annotations: ~100 tokens
- Overhead: ~162 tokens

#### Read Tool (671 tokens)
```javascript
{
  name: "read",
  description: "Read full conversations to extract detailed context after finding relevant results with search. Essential for understanding the complete rationale, evolution, and gotchas behind past decisions. Use startLine/endLine pagination for large conversations to avoid context bloat (line numbers are 1-indexed).",
  inputSchema: { /* Schema with 3 properties */ },
  annotations: { /* 5 metadata fields */ }
}
```

**Token breakdown estimate**:
- Description: ~237 characters = ~60 tokens
- Input schema (3 properties): ~350 tokens
- Annotations: ~100 tokens
- Overhead: ~161 tokens

## Optimization Opportunities

### 1. Shorten Tool Descriptions (Recommended)

The descriptions are comprehensive but verbose. They could be reduced by 30-40% without losing essential information.

#### Current vs. Optimized

**Search Tool - Current** (340 chars):
> Gives you memory across sessions. You don't automatically remember past conversations - this tool restores context by searching them. Use BEFORE every task to recover decisions, solutions, and avoid reinventing work. Single string for semantic search or array of 2-5 concepts for precise AND matching. Returns ranked results with project, date, snippets, and file paths.

**Search Tool - Optimized** (220 chars, -35%):
> Search past Claude Code conversations using semantic or text search. Single string for semantic search or array of 2-5 concepts for AND matching. Returns ranked results with project, date, snippets, and file paths.

**Savings**: ~30 tokens per tool

---

**Read Tool - Current** (237 chars):
> Read full conversations to extract detailed context after finding relevant results with search. Essential for understanding the complete rationale, evolution, and gotchas behind past decisions. Use startLine/endLine pagination for large conversations to avoid context bloat (line numbers are 1-indexed).

**Read Tool - Optimized** (150 chars, -37%):
> Read full conversations from search results. Use startLine/endLine pagination for large conversations (line numbers are 1-indexed).

**Savings**: ~22 tokens per tool

**Total savings from description optimization**: ~50-60 tokens (~3-4% reduction)

### 2. Simplify Input Schemas (Advanced)

The input schemas include extensive validation rules and metadata that contribute to token consumption. However, these provide important type safety and validation.

**Potential optimizations**:
- Remove default value declarations (if defaults can be handled server-side)
- Consolidate enum declarations
- Simplify pattern matching for date validation

**Estimated savings**: ~100-150 tokens (8-10% reduction)
**Risk**: May reduce DX clarity in tool invocation

### 3. Reduce or Remove Annotations (Not Recommended)

Annotations provide metadata hints to Claude Code but consume ~200 tokens total.

**Fields**:
- `title`: User-friendly name
- `readOnlyHint`: Indicates read-only operation
- `destructiveHint`: Indicates destructive operation
- `idempotentHint`: Indicates idempotent operation
- `openWorldHint`: Indicates if tool accesses external resources

**Estimated savings**: ~200 tokens (13% reduction)
**Risk**: Loss of important behavioral hints for the LLM

## Recommendations (Prioritized)

### Priority 1: Description Optimization
- **Effort**: Low
- **Savings**: 50-60 tokens
- **Risk**: None (maintains essential information)
- **Action**: Submit PR to episodic-memory plugin with optimized descriptions

### Priority 2: Schema Simplification
- **Effort**: Medium
- **Savings**: 100-150 tokens
- **Risk**: Low (if defaults handled server-side)
- **Action**: Review schema and remove redundant validation where safe

### Priority 3: Annotation Review
- **Effort**: Low
- **Savings**: 200 tokens
- **Risk**: Medium (may reduce LLM understanding)
- **Action**: Only if desperate for context - not recommended

## Total Potential Savings

**Conservative approach** (Priority 1 only):
- Current: 1,518 tokens
- Optimized: 1,460 tokens
- **Savings: 60 tokens (4% reduction)**

**Moderate approach** (Priority 1 + 2):
- Current: 1,518 tokens
- Optimized: 1,310 tokens
- **Savings: 210 tokens (14% reduction)**

**Aggressive approach** (All priorities):
- Current: 1,518 tokens
- Optimized: 1,110 tokens
- **Savings: 410 tokens (27% reduction)**

## Implementation Path

1. **Fork episodic-memory plugin**
   ```bash
   gh repo fork obra/episodic-memory --clone --remote
   ```

2. **Modify tool descriptions**
   - Location: `src/mcp-server.ts`
   - Update descriptions with optimized versions

3. **Test changes**
   ```bash
   npm run build  # Rebuild dist files
   # Restart Claude Code session
   # Verify tools still work correctly
   ```

4. **Submit PR to upstream**
   - Document token savings in PR description
   - Emphasize maintenance of essential information
   - Propose as optional optimization flag if maintainer prefers

## Summary

The episodic-memory plugin's MCP tools consume ~1.5k tokens. Through description optimization (Priority 1), we can save 50-60 tokens with zero risk. More aggressive optimizations (schema simplification, annotation removal) could save up to 410 tokens but carry some risk of reduced functionality or DX.

Recommended approach: Start with Priority 1 (description optimization) as a low-risk, immediate improvement.

---

**Related Files**:
- Tool definitions: `src/mcp-server.ts`
- Plugin config: `.claude-plugin/plugin.json`

**Date**: December 2025
