# Design System Specification: Singapore Home Intel

> **Historical / superseded — archived 8 October 2026.** Preserve this document as dated evidence, not current instructions or release approval. Current guidance: [AGENTS.md](../../../AGENTS.md), [PRODUCT_SPEC.md](../../PRODUCT_SPEC.md), [OPERATIONS.md](../../OPERATIONS.md).


> **Philosophy:** *Minimal, Friendly, Warm.*
> The goal of this design system is to make finding a home feel welcoming, calm, and approachable. It strips away technical real estate jargon and dense layouts in favor of warm natural tones, generous breathing room, soft rounded geometry, and legible typography.

---

## 1. Design Tokens & Foundations

### 1.1 Color Palette
The color system uses warm, earth-inspired tones paired with clean neutrals to evoke comfort, safety, and home.

#### Core Brand Colors
| Token Name | Hex Code | Role / Usage |
| :--- | :--- | :--- |
| `color-primary-green` | `#4F7942` | Primary brand color, main CTAs, active states, key icons |
| `color-primary-terracotta` | `#CB6D51` | Warm accent, highlights, favorite indicators, secondary badges |
| `color-accent-teal` | `#00B080` | Interactive accents, verified badges, success states |

#### Natural Background & Neutral Tones
| Token Name | Hex Code | Role / Usage |
| :--- | :--- | :--- |
| `color-bg-sunlit` | `#FFFAF0` | Primary app background (warm off-white, light sunlit tone) |
| `color-bg-sand` | `#F0E6D2` | Surface/card background, soft container fills, input backgrounds |
| `color-text-charcoal` | `#36454F` | Primary text color (soft dark charcoal instead of harsh pure black) |
| `color-text-muted` | `#6A7B82` | Secondary text, captions, metadata |
| `color-border-subtle` | `rgba(54, 69, 79, 0.12)` | Subtle card borders and dividers |

---

### 1.2 Typography System

**Font Families:**
* **Headings & Display:** `Montserrat` (Clean, rounded, approachable sans-serif)
* **Body Copy & UI Text:** `Open Sans` (Highly legible, neutral, warm readable sans-serif)

#### Typography Scale & Styles

```css
:root {
  /* Headings */
  --font-heading: 'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-body: 'Open Sans', -apple-system, BlinkMacSystemFont, sans-serif;

  /* Font Sizes */
  --text-h1: bold 32px/1.2 var(--font-heading);
  --text-h2: bold 24px/1.3 var(--font-heading);
  --text-h3: 600 18px/1.4 var(--font-heading);
  
  --text-body-large: 400 16px/1.5 var(--font-body);
  --text-body-regular: 400 14px/1.5 var(--font-body);
  --text-caption: 400 12px/1.4 var(--font-body);
  --text-button: 600 14px/1.0 var(--font-heading);
}