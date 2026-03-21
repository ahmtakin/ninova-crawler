# Frutiger Aero UI Redesign Plan

> **Status:** Proposed
> **Date:** 2026-03-22
> **Feature:** Apply Frutiger Aero design language to the Ninova dashboard

---

## What is Frutiger Aero?

**Frutiger Aero** (also known as "Aero" or "Web 2.0 glossy") was a dominant design aesthetic from 2004–2013, popularized by:
- Windows Vista/7 Aero Glass
- iOS 1–6 (skeuomorphic icons)
- Early web apps (Facebook, Twitter, Dropbox)

### Key Visual Characteristics

| Element | Description |
|---------|-------------|
| **Aero Glass** | Semi-transparent backgrounds with blur |
| **Glossy Surfaces** | Top highlight gradient + subtle inner shadow |
| **Soft Gradients** | Blue → White, Green → White, aquamarine tones |
| **Rounded Shapes** | Large border-radius (12–20px) |
| **Glow Effects** | Outer drop shadow + inner glow |
| **Reflections** | Shine on top half, subtle bottom fade |
| **Nature Accents** | Water droplets, leaves, bubbles |
| **Bright Colors** | Sky blue, grass green, pure white |
| **Light Shadows** | Soft drop shadows, not harsh |
| **Clean Typography** | Sans-serif, readable, friendly |

---

## Current vs. Target Design

### Current (Dark Theme)
```
┌─────────────────────────────────────┐
│  Dark background (#0f1117)          │
│  Purple/blue gradient text           │
│  Flat borders                        │
│  Minimal shadows                     │
└─────────────────────────────────────┘
```

### Target (Frutiger Aero)
```
╭─────────────────────────────────────╮
│  ┌─────────────────────────────────┐ │
│  │ Sky blue gradient (glossy)     │ │
│  │                                 │ │
│  │  🕷️ Crawler    🔍 Search       │ │
│  │  [Glass cards with shine]       │ │
│  │                                 │ │
│  └─────────────────────────────────┘ │
│  Aero glass blur effect              │
│  Soft outer glow                     │
╰─────────────────────────────────────╯
```

---

## Color Palette

### Primary Colors

| Usage | Color | CSS |
|-------|-------|-----|
| Sky Blue (primary) | `#4A90D9` → `#7EC8E3` | Linear gradient |
| Aqua (secondary) | `#50C8C8` → `#A0E6E6` | Linear gradient |
| Leaf Green (success) | `#7ED321` → `#B8F26A` | Linear gradient |
| Sun Orange (warning) | `#FFB347` → `#FFD27F` | Linear gradient |
| Water White (bg) | `#F0F8FF` → `#FFFFFF` | Subtle gradient |
| Glass (overlay) | `rgba(255, 255, 255, 0.3)` | With blur |

### Gradients

```css
/* Sky Blue Gloss */
--sky-gradient: linear-gradient(180deg, #7EC8E3 0%, #4A90D9 100%);

/* Aqua Gloss */
--aqua-gradient: linear-gradient(180deg, #A0E6E6 0%, #50C8C8 100%);

/* Leaf Green */
--leaf-gradient: linear-gradient(180deg, #B8F26A 0%, #7ED321 100%);

/* Background */
--bg-gradient: linear-gradient(180deg, #FFFFFF 0%, #F0F8FF 100%);
```

---

## File-by-File Implementation Plan

### Phase 1: CSS Variables & Base Styles

**File:** `public/style.css`

#### Step 1.1: Replace CSS variables (lines 4–17)

**Before:**
```css
:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --surface-hover: #22263a;
  --border: #2a2e3f;
  --text: #e4e6ef;
  --text-muted: #8b8fa3;
  --primary: #6366f1;
  --primary-hover: #818cf8;
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
  --info: #3b82f6;
  --radius: 8px;
}
```

**After:**
```css
:root {
  /* Backgrounds */
  --bg-start: #FFFFFF;
  --bg-end: #F0F8FF;
  --glass-bg: rgba(255, 255, 255, 0.6);
  --glass-border: rgba(255, 255, 255, 0.8);

  /* Gradients */
  --sky-gradient: linear-gradient(180deg, #7EC8E3 0%, #4A90D9 100%);
  --aqua-gradient: linear-gradient(180deg, #A0E6E6 0%, #50C8C8 100%);
  --leaf-gradient: linear-gradient(180deg, #B8F26A 0%, #7ED321 100%);
  --sun-gradient: linear-gradient(180deg, #FFD27F 0%, #FFB347 100%);
  --rose-gradient: linear-gradient(180deg, #FF9A9E 0%, #F4676C 100%);

  /* Text */
  --text: #2C3E50;
  --text-muted: #7F8C8D;
  --text-white: #FFFFFF;

  /* Colors */
  --primary: #4A90D9;
  --primary-hover: #7EC8E3;
  --success: #7ED321;
  --warning: #FFB347;
  --danger: #F4676C;
  --info: #50C8C8;

  /* Effects */
  --radius: 16px;
  --shadow-soft: 0 4px 12px rgba(74, 144, 217, 0.15);
  --shadow-glow: 0 0 20px rgba(74, 144, 217, 0.2);
  --shadow-inset: inset 0 1px 0 rgba(255, 255, 255, 0.8);
  --gloss-shine: linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 50%);
}
```

#### Step 1.2: Update body background (lines 20–26)

**Before:**
```css
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  min-height: 100vh;
}
```

**After:**
```css
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-gradient);
  color: var(--text);
  line-height: 1.6;
  min-height: 100vh;
  position: relative;
}

/* Add subtle gradient overlay */
body::before {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background:
    radial-gradient(circle at 20% 20%, rgba(126, 200, 227, 0.1) 0%, transparent 50%),
    radial-gradient(circle at 80% 80%, rgba(80, 200, 200, 0.1) 0%, transparent 50%);
  pointer-events: none;
  z-index: -1;
}
```

---

### Phase 2: Header Redesign

#### Step 2.1: New header styling

**File:** `public/style.css`

Replace entire header section (lines 28–68):

```css
/* ── Header ──────────────────────────────────────── */
header {
  padding: 1.5rem 2rem;
  margin: 1.5rem 2rem 0;
  background: var(--sky-gradient);
  border-radius: var(--radius);
  box-shadow:
    var(--shadow-soft),
    var(--shadow-glow);
  position: relative;
  overflow: hidden;
}

/* Gloss shine effect */
header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: var(--gloss-shine);
  pointer-events: none;
}

/* Inner glow/inset shadow */
header::after {
  content: '';
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  bottom: 8px;
  border-radius: 12px;
  box-shadow: var(--shadow-inset);
  pointer-events: none;
}

header h1 {
  font-size: 1.75rem;
  font-weight: 700;
  background: linear-gradient(135deg, #FFFFFF 0%, #E0F7FA 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  position: relative;
  z-index: 1;
}

.subtitle {
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.85rem;
  position: relative;
  z-index: 1;
}

.system-status {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.9);
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  position: relative;
  z-index: 1;
  backdrop-filter: blur(10px);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.3);
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--warning);
  transition: all 0.3s ease;
  box-shadow: 0 0 8px rgba(255, 179, 71, 0.5);
}

.status-dot.connected {
  background: var(--success);
  box-shadow: 0 0 8px rgba(126, 211, 33, 0.5);
}

.status-dot.disconnected {
  background: var(--danger);
  box-shadow: 0 0 8px rgba(244, 103, 108, 0.5);
}
```

---

### Phase 3: Feature Selector Cards (Glossy Buttons)

#### Step 3.1: Replace feature card styles

**File:** `public/style.css`

Replace entire `.feature-selector` and `.feature-card` sections:

```css
/* ── Feature Selector Cards ───────────────────────────── */
.feature-selector {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
  margin-bottom: 1.5rem;
}

.feature-card {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 1.5rem;
  background: var(--sky-gradient);
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.3s ease;
  text-align: left;
  width: 100%;
  position: relative;
  overflow: hidden;
  box-shadow:
    var(--shadow-soft),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

/* Gloss shine on hover */
.feature-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: var(--gloss-shine);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.feature-card:hover {
  transform: translateY(-4px);
  box-shadow:
    0 8px 24px rgba(74, 144, 217, 0.3),
    0 0 30px rgba(74, 144, 217, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.6);
}

.feature-card:hover::before {
  opacity: 1;
}

.feature-card.active {
  background: var(--aqua-gradient);
  border-color: rgba(255, 255, 255, 0.8);
  box-shadow:
    0 0 0 3px rgba(80, 200, 200, 0.3),
    0 8px 24px rgba(80, 200, 200, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.feature-card.active::before {
  opacity: 1;
}

.feature-card:focus {
  outline: none;
  box-shadow:
    0 0 0 4px rgba(74, 144, 217, 0.5),
    var(--shadow-soft);
}

.feature-icon {
  font-size: 2.5rem;
  line-height: 1;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15));
  position: relative;
  z-index: 1;
}

.feature-info h3 {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-white);
  margin-bottom: 0.35rem;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  position: relative;
  z-index: 1;
}

.feature-info p {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.15);
  position: relative;
  z-index: 1;
}
```

---

### Phase 4: Card Styles (Aero Glass)

#### Step 4.1: Replace card styles

```css
/* ── Card ────────────────────────────────────────── */
.card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  padding: 1.5rem;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow:
    var(--shadow-soft),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  position: relative;
}

/* Card gloss shine */
.card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: var(--gloss-shine);
  border-radius: var(--radius) var(--radius) 0 0;
  pointer-events: none;
}

.card h2 {
  font-size: 1.2rem;
  font-weight: 700;
  margin-bottom: 1.25rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--primary);
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.5);
  position: relative;
  z-index: 1;
}

/* Add inner glow to cards */
.card::after {
  content: '';
  position: absolute;
  top: 6px;
  left: 6px;
  right: 6px;
  bottom: 6px;
  border-radius: 12px;
  box-shadow: var(--shadow-inset);
  pointer-events: none;
}
```

---

### Phase 5: Button Styles (Glossy Web 2.0)

#### Step 5.1: Replace button styles

Find and replace the entire button section:

```css
/* ── Buttons ───────────────────────────────────────── */
button {
  background: var(--sky-gradient);
  color: var(--text-white);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: var(--radius);
  padding: 0.75rem 1.5rem;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
  box-shadow:
    0 2px 8px rgba(74, 144, 217, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
}

/* Button gloss shine */
button::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: var(--gloss-shine);
  pointer-events: none;
}

button:hover {
  transform: translateY(-2px);
  background: linear-gradient(180deg, #8FD4F9 0%, #5BA3D9 100%);
  box-shadow:
    0 4px 16px rgba(74, 144, 217, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.6);
}

button:active {
  transform: translateY(0);
  box-shadow:
    0 1px 4px rgba(74, 144, 217, 0.3),
    inset 0 1px 2px rgba(0, 0, 0, 0.1);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

button.secondary {
  background: linear-gradient(180deg, #E8F4F8 0%, #D0E8F0 100%);
  color: var(--primary);
  border-color: rgba(74, 144, 217, 0.3);
  box-shadow:
    0 2px 8px rgba(74, 144, 217, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

button.secondary:hover {
  background: linear-gradient(180deg, #F0F8FC 0%, #E0F0F8 100%);
  box-shadow:
    0 4px 16px rgba(74, 144, 217, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 1);
}

button.danger {
  background: var(--rose-gradient);
  box-shadow:
    0 2px 8px rgba(244, 103, 108, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

button.danger:hover {
  background: linear-gradient(180deg, #FFB3B8 0%, #F07A7F 100%);
  box-shadow:
    0 4px 16px rgba(244, 103, 108, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
```

---

### Phase 6: Form Input Styles

#### Step 6.1: Update input styles

```css
/* ── Forms ───────────────────────────────────────── */
.form-row {
  display: flex;
  gap: 0.75rem;
  align-items: flex-end;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
}

.form-group label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--primary);
  text-transform: none;
  letter-spacing: 0;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.5);
}

input[type="url"],
input[type="text"],
input[type="number"] {
  background: var(--glass-bg);
  border: 2px solid rgba(74, 144, 217, 0.3);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
  transition: all 0.2s ease;
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.05),
    0 1px 2px rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(10px);
}

input:focus {
  border-color: var(--primary);
  box-shadow:
    0 0 0 3px rgba(74, 144, 217, 0.2),
    inset 0 2px 4px rgba(0, 0, 0, 0.05);
}

input::placeholder {
  color: var(--text-muted);
}
```

---

### Phase 7: Job Cards (Bubble Style)

#### Step 7.1: Update job card styles

```css
/* ── Job Cards ───────────────────────────────────── */
.job-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  padding: 1.25rem;
  margin-bottom: 1rem;
  backdrop-filter: blur(15px);
  box-shadow:
    var(--shadow-soft),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  position: relative;
}

.job-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: var(--gloss-shine);
  border-radius: var(--radius) var(--radius) 0 0;
  pointer-events: none;
}

.job-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  position: relative;
  z-index: 1;
}

.job-origin {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--primary);
  word-break: break-all;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.3);
}

.job-status {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.3rem 0.8rem;
  border-radius: 20px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-white);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  position: relative;
}

/* Status colors with glossy gradients */
.job-status.running {
  background: var(--leaf-gradient);
  box-shadow: 0 2px 6px rgba(126, 211, 33, 0.3);
}

.job-status.paused {
  background: var(--sun-gradient);
  box-shadow: 0 2px 6px rgba(255, 179, 71, 0.3);
}

.job-status.completed {
  background: var(--sky-gradient);
  box-shadow: 0 2px 6px rgba(74, 144, 217, 0.3);
}

.job-status.failed {
  background: var(--rose-gradient);
  box-shadow: 0 2px 6px rgba(244, 103, 108, 0.3);
}

.job-status.queued {
  background: linear-gradient(180deg, #B8B8B8 0%, #909090 100%);
}

.job-status.cancelled {
  background: linear-gradient(180deg, #C0C0C0 0%, #989898 100%);
}
```

---

### Phase 8: Progress Bar (Liquid Style)

#### Step 8.1: Replace progress bar styles

```css
/* ── Progress Bar ────────────────────────────────── */
.progress-bar {
  width: 100%;
  height: 12px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 10px;
  border: 1px solid rgba(74, 144, 217, 0.2);
  overflow: hidden;
  margin: 0.75rem 0;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05);
}

.progress-fill {
  height: 100%;
  background: var(--leaf-gradient);
  border-radius: 8px;
  transition: width 0.5s ease;
  box-shadow:
    0 0 10px rgba(126, 211, 33, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
  position: relative;
}

/* Gloss shine on progress bar */
.progress-fill::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: var(--gloss-shine);
  border-radius: 8px 8px 0 0;
}

.progress-fill.throttled {
  background: var(--sun-gradient);
  box-shadow:
    0 0 10px rgba(255, 179, 71, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
```

---

### Phase 9: Badge, Feedback, and Utility Updates

#### Step 9.1: Update badges

```css
/* ── Badge ───────────────────────────────────────── */
.badge {
  background: var(--rose-gradient);
  color: var(--text-white);
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.25rem 0.65rem;
  border-radius: 12px;
  box-shadow: 0 2px 6px rgba(244, 103, 108, 0.3);
}
```

#### Step 9.2: Update feedback messages

```css
/* ── Feedback ────────────────────────────────────── */
.feedback {
  margin-top: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius);
  font-size: 0.9rem;
  font-weight: 500;
  box-shadow:
    var(--shadow-soft),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.feedback.success {
  background: var(--leaf-gradient);
  color: var(--text-white);
  box-shadow:
    0 2px 8px rgba(126, 211, 33, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.feedback.error {
  background: var(--rose-gradient);
  color: var(--text-white);
  box-shadow:
    0 2px 8px rgba(244, 103, 108, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
```

#### Step 9.3: Update empty state

```css
.empty-state {
  color: var(--text-muted);
  font-size: 0.9rem;
  text-align: center;
  padding: 2rem 1rem;
  font-style: italic;
}
```

---

### Phase 10: Footer Styling

#### Step 10.1: Update footer

```css
/* ── Footer ──────────────────────────────────────── */
footer {
  text-align: center;
  padding: 2rem;
  color: var(--text-muted);
  font-size: 0.8rem;
  border-top: 1px solid rgba(74, 144, 217, 0.2);
  margin-top: 2rem;
}
```

---

## Additional Optional Enhancements

### Nature Accents (Optional Add-ons)

These can be added after the base redesign:

1. **Water Droplet Decorations**
   - CSS-only droplet shapes using `border-radius`
   - Place in corners of cards
   - Animate with subtle float

2. **Leaf/Badge Accents**
   - Small leaf shapes on success states
   - Use CSS `::before`/`::after` pseudo-elements

3. **Bubble Accents**
   - Floating circles in background
   - Animate with CSS keyframes

4. **Reflection Effect**
   - Mirror effect below header
   - Using `transform: scaleY(-1)` with opacity

### Example Water Droplet CSS

```css
/* Add to feature cards */
.feature-card::after {
  content: '';
  position: absolute;
  bottom: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), transparent 50%);
  border-radius: 50% 50% 50% 50%;
  opacity: 0.6;
}
```

---

## Implementation Checklist

### Core Redesign (Required)
- [ ] Phase 1: CSS variables & base styles
- [ ] Phase 2: Header redesign
- [ ] Phase 3: Feature selector cards
- [ ] Phase 4: Card (Aero glass) styles
- [ ] Phase 5: Button (glossy) styles
- [ ] Phase 6: Form input styles
- [ ] Phase 7: Job card styles
- [ ] Phase 8: Progress bar styles
- [ ] Phase 9: Badge, feedback, utility updates
- [ ] Phase 10: Footer styling

### Testing & Verification
- [ ] Test all buttons have gloss effect
- [ ] Test hover states work smoothly
- [ ] Test forms are usable with new styling
- [ ] Test job cards display correctly
- [ ] Test progress bars look good
- [ ] Test mobile responsiveness
- [ ] Test accessibility (contrast, focus states)

### Optional Enhancements (Future)
- [ ] Water droplet decorations
- [ ] Bubble animations
- [ ] Reflection effect on header
- [ ] Nature accent icons

---

## Rollback Plan

If issues arise:

1. **Quick revert:** Revert the CSS file commit
2. **Partial revert:** Keep CSS variables, revert visual effects
3. **Safe fallback:** Original dark theme still works if CSS fails to load

---

## Success Criteria

- [ ] Sky blue/aqua color scheme applied
- [ ] Glossy shine effects on buttons and cards
- [ ] Aero glass blur effect on cards
- [ ] Soft shadows and glows throughout
- [ ] Rounded corners (16px radius)
- [ ] All functionality preserved
- [ ] Mobile responsive
- [ ] Accessible (contrast ratio 4.5:1+)

---

## File Summary

| File | Lines Changed | Complexity |
|------|---------------|------------|
| `public/style.css` | ~400 lines | Moderate (CSS-only) |
| `public/index.html` | 0 lines | None (HTML unchanged) |
| `public/app.js` | 0 lines | None (JS unchanged) |

**Total:** ~400 lines of CSS changes

---

## Preview Notes

This redesign will give the dashboard a **cheerful, friendly, nostalgic** look reminiscent of:
- Windows 7 Aero Glass interface
- iOS 1–6 app icons
- 2010-era web apps (Dropbox, Twitter, early Facebook)
- Microsoft Office 2007–2010 "ribbon" interface

The aesthetic emphasizes **clarity, friendliness, and approachability** while maintaining modern usability standards.
