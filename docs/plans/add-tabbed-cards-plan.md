# Tabbed Cards UI Plan

> **Status:** Proposed
> **Date:** 2026-03-22
> **Feature:** Add selectable/tabbed cards for Crawler and Search functionalities

---

## Overview

Transform the current stacked layout into two main selectable cards ("Crawler" and "Search") that act as tabs. Users select a card to reveal its functionality.

### Current Layout (Stacked)
```
┌─────────────────────────────────────┐
│  Start a Crawl (form)               │
├─────────────────────────────────────┤
│  Crawl Jobs (list)                  │
├─────────────────────────────────────┤
│  Search (form + results)            │
└─────────────────────────────────────┘
```

### New Layout (Tabbed Cards)
```
┌─────────────────────────────────────┐
│  ┌─────────┐  ┌─────────┐          │
│  │ CRAWLER │  │ SEARCH  │          │  ← Selectable cards (always visible)
│  └─────────┘  └─────────┘          │
├─────────────────────────────────────┤
│                                     │
│  [Active Card Content]              │  ← Shows when card is selected
│                                     │
│  • When CRAWLER selected:           │
│    - Start Crawl form               │
│    - Crawl Jobs list                │
│                                     │
│  • When SEARCH selected:            │
│    - Search form                    │
│    - Search results                 │
│                                     │
└─────────────────────────────────────┘
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `public/index.html` | Restructure HTML with card selector tabs |
| `public/style.css` | Add tab styles, active states, transitions |
| `public/app.js` | Add tab switching logic, state management |

---

## Step-by-Step Implementation Plan

### Phase 1: HTML Structure

#### Step 1.1: Add card selector tabs

**File:** `public/index.html`

Add a new section after `<main>` that contains the two selectable cards:

```html
<main>
  <!-- ── Feature Selector Cards ───────────────────── -->
  <section class="feature-selector">
    <button class="feature-card active" data-feature="crawler" id="crawler-card">
      <div class="feature-icon">🕷️</div>
      <div class="feature-info">
        <h3>Crawler</h3>
        <p>Start and manage crawl jobs</p>
      </div>
    </button>
    <button class="feature-card" data-feature="search" id="search-card">
      <div class="feature-icon">🔍</div>
      <div class="feature-info">
        <h3>Search</h3>
        <p>Search indexed pages</p>
      </div>
    </button>
  </section>

  <!-- ── Feature Content Area ───────────────────────── -->
  <section id="feature-content">
    <!-- Crawler Content (shown by default) -->
    <div id="crawler-content" class="feature-panel active">
      <!-- Start a Crawl -->
      <section class="card" id="crawl-section">
        <h2>Start a Crawl</h2>
        ... (existing crawl form) ...
      </section>

      <!-- Crawl Jobs -->
      <section class="card" id="jobs-section">
        <h2>Crawl Jobs <span id="active-count" class="badge">0</span></h2>
        <div id="jobs-container">
          <p class="empty-state">No crawl jobs yet. Start one above.</p>
        </div>
      </section>
    </div>

    <!-- Search Content (hidden by default) -->
    <div id="search-content" class="feature-panel">
      <section class="card" id="search-section">
        <h2>Search</h2>
        ... (existing search form + results) ...
      </section>
    </div>
  </section>
</main>
```

#### Step 1.2: Remove old structure

Delete the old `<section>` elements that were directly under `<main>` and reorganize into the new structure above.

---

### Phase 2: CSS Styles

#### Step 2.1: Add feature selector styles

**File:** `public/style.css`

Add after the `/* ── Header ──── */` section:

```css
/* ── Feature Selector Cards ───────────────────────── */
.feature-selector {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.feature-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.3s ease;
  text-align: left;
  width: 100%;
}

.feature-card:hover {
  border-color: var(--primary);
  background: var(--surface-hover);
  transform: translateY(-2px);
}

.feature-card.active {
  border-color: var(--primary);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(167, 139, 250, 0.1));
  box-shadow: 0 0 0 1px var(--primary);
}

.feature-card:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.3);
}

.feature-icon {
  font-size: 2rem;
  line-height: 1;
}

.feature-info h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 0.25rem;
}

.feature-info p {
  font-size: 0.8rem;
  color: var(--text-muted);
}
```

#### Step 2.2: Add feature panel styles

```css
/* ── Feature Panels ─────────────────────────────────── */
#feature-content {
  position: relative;
}

.feature-panel {
  display: none;
  animation: fadeIn 0.3s ease;
}

.feature-panel.active {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

#### Step 2.3: Add responsive adjustments

Update the responsive section at the end:

```css
/* ── Responsive ──────────────────────────────────── */
@media (max-width: 640px) {
  .form-row { flex-direction: column; }
  .job-stats { grid-template-columns: repeat(2, 1fr); }
  header { flex-wrap: wrap; }
  .system-status { width: 100%; }

  /* New: stack feature cards on mobile */
  .feature-selector {
    grid-template-columns: 1fr;
  }

  .feature-card {
    padding: 1rem;
  }
}
```

---

### Phase 3: JavaScript Logic

#### Step 3.1: Add feature switching state and functions

**File:** `public/app.js`

Add after the existing state declarations (around line 14):

```javascript
// ── Feature Panel State ──────────────────────────────
let currentFeature = 'crawler'; // 'crawler' or 'search'
```

Add after the DOM references section:

```javascript
// ── Feature Panel References ──────────────────────────
const crawlerCard = document.getElementById('crawler-card');
const searchCard = document.getElementById('search-card');
const crawlerContent = document.getElementById('crawler-content');
const searchContent = document.getElementById('search-content');
```

Add these new functions:

```javascript
// ── Feature Panel Switching ──────────────────────────
function switchFeature(feature) {
  if (feature === currentFeature) return;

  // Update state
  currentFeature = feature;

  // Update card states
  if (feature === 'crawler') {
    crawlerCard.classList.add('active');
    searchCard.classList.remove('active');
    crawlerContent.classList.add('active');
    searchContent.classList.remove('active');
  } else {
    searchCard.classList.add('active');
    crawlerCard.classList.remove('active');
    searchContent.classList.add('active');
    crawlerContent.classList.remove('active');
  }
}

// ── Feature Card Click Handlers ───────────────────────
crawlerCard.addEventListener('click', () => switchFeature('crawler'));
searchCard.addEventListener('click', () => switchFeature('search'));
```

#### Step 3.2: Initialize default state

Add to the initialization section (at the end of app.js):

```javascript
// ── Initialize Feature Panels ─────────────────────────
// Ensure crawler panel is active by default
switchFeature('crawler');
```

---

### Phase 4: Testing & Verification

#### Test 4.1: Visual verification

1. Load dashboard at http://localhost:3000
2. Verify two feature cards are visible at the top
3. Verify "Crawler" card is active (highlighted)
4. Verify crawl form and jobs list are visible below
5. Verify search content is hidden

#### Test 4.2: Card switching

1. Click "Search" card
2. Verify:
   - "Search" card becomes active (highlighted)
   - "Crawler" card becomes inactive
   - Search form appears below with fade animation
   - Crawl content disappears

3. Click "Crawler" card
4. Verify:
   - "Crawler" card becomes active again
   - Search content disappears
   - Crawl content reappears

#### Test 4.3: Functionality preservation

1. **Crawler functionality:**
   - Start a crawl job while on Crawler tab
   - Switch to Search tab
   - Switch back to Crawler tab
   - Verify job is still running and list is updated

2. **Search functionality:**
   - Switch to Search tab
   - Enter a search query
   - Verify results appear
   - Switch to Crawler tab
   - Switch back to Search tab
   - Verify search results are preserved

#### Test 4.4: State persistence across SSE updates

1. Start a crawl job
2. Switch to Search tab
3. Wait for SSE updates (job progress)
4. Switch back to Crawler tab
5. Verify job list shows latest data (no stale state)

#### Test 4.5: Keyboard accessibility

1. Use Tab to navigate to feature cards
2. Verify focus ring appears
3. Press Enter to activate
4. Verify correct panel shows

#### Test 4.6: Mobile responsiveness

1. Resize browser to < 640px width
2. Verify feature cards stack vertically
3. Verify touch targets are large enough
4. Test card switching on mobile

---

### Phase 5: Optional Enhancements (Future)

These are NOT part of this plan but could be added later:

1. **URL-based routing** - Update URL hash (#crawler or #search) so browser back button works
2. **Keyboard shortcuts** - Alt+C for crawler, Alt+S for search
3. **Badge counts** - Show active job count on crawler card, result count on search card
4. **Remember last tab** - Store selection in localStorage
5. **Transition effects** - More elaborate animations between panels

---

## Success Criteria

- [ ] Two feature cards (Crawler, Search) visible at top
- [ ] Clicking a card switches the content below
- [ ] Active card has visual highlight (border, background, shadow)
- [ ] Smooth fade animation when switching panels
- [ ] All existing functionality preserved (crawl, search, SSE updates)
- [ ] Works on mobile (cards stack vertically)
- [ ] Keyboard accessible (Tab, Enter, focus indicators)

---

## Rollback Plan

If issues arise:

1. **Quick revert:** Revert the commits for this feature
2. **Partial revert:** Keep CSS changes, revert HTML/JS if needed
3. **Fallback:** Original layout still works if feature-panel classes fail

---

## Implementation Checklist

- [ ] Phase 1: HTML Structure
  - [ ] Step 1.1: Add feature selector cards HTML
  - [ ] Step 1.2: Reorganize content into feature panels
- [ ] Phase 2: CSS Styles
  - [ ] Step 2.1: Add feature selector card styles
  - [ ] Step 2.2: Add feature panel animation styles
  - [ ] Step 2.3: Add responsive adjustments
- [ ] Phase 3: JavaScript Logic
  - [ ] Step 3.1: Add state and switchFeature() function
  - [ ] Step 3.2: Add click handlers
  - [ ] Step 3.3: Initialize default state
- [ ] Phase 4: Testing
  - [ ] Test 4.1: Visual verification
  - [ ] Test 4.2: Card switching
  - [ ] Test 4.3: Functionality preservation
  - [ ] Test 4.4: SSE state updates
  - [ ] Test 4.5: Keyboard accessibility
  - [ ] Test 4.6: Mobile responsiveness

---

## Files Summary

| File | Lines Added | Lines Modified |
|------|-------------|----------------|
| `public/index.html` | ~30 | ~15 |
| `public/style.css` | ~80 | ~10 |
| `public/app.js` | ~25 | ~0 |
| **Total** | **~135** | **~25** |
