# Client Intelligence — Setup Checklist (for the team)

The Intelligence tab is only as sharp as what each client profile feeds it.
Spend ~5 minutes per client on the steps below and the engine produces relevant
bills, offices, regs, and money‑flow intel with actionable next steps. Skip them
and panels look empty.

> Rule of thumb: **garbage in → garbage out.** Empty panels almost always mean a
> missing *confirmed mapping* or *too‑vague tags* — fix the input, not the output.

---

## ⭐ Do this first (the keystone)
- [ ] **Confirm the client's LDA mapping** — Settings → Intelligence Mappings.
      This pulls in the client's real lobbying issue areas, which generate the
      *tracked bills* that power the office recommender, hearings, regs, and
      competitor views. No confirmed LDA mapping = mostly empty intel.

## The 5‑minute setup (priority order — each row says what it unlocks)
- [ ] **LDA Issue Codes** (client form → Sector & Tracks) — auto‑fills from the LDA
      match; you can add/override. *Drives bill + regulation matching even with no
      LDA mapping*, so set 2–4 here for brand‑new clients.
- [ ] **Capability tags — be specific.** "hypersonics", "electronic warfare",
      "shipbuilding" pull the right bills; "defense", "technology", "solutions"
      pull noise. Acronyms auto‑expand (tag **EW / C2 / ISR / UAS** and the engine
      reads the full phrase).
- [ ] **Capability descriptions + justification + district nexus** — a sentence or
      two of plain English each. This feeds the semantic matcher; empty
      descriptions = weaker bill matches.
- [ ] **Confirm the contracting mapping** → federal obligations, return ratio, and
      real district‑by‑dollars nexus.
- [ ] **Confirm the FEC employer mapping** → employer‑linked contribution panel
      (use one canonical employer name; subsidiaries won't auto‑combine).
- [ ] **Set the client Sector** (controlled list) → agency/regulation matching +
      defense tailoring.
- [ ] **Log CRM activity** (meetings, emails, tasks, debriefs) → the health score.

## How to read the outputs for action
| Panel | How to use it |
|---|---|
| **Office recommender** | Your call sheet — work top‑down. Read the tags: **Committee** = highest‑leverage first call · **Sponsor** = on‑record ally to brief · **District** = lead with local jobs · **Ex‑staffer** = warm intro via your team · **FEC** = context only. |
| **Bill pipeline** | Shows bills with real momentum (≥60% likelihood) by default; "show all" for the tail. Pin any bill the matcher misses. |
| **Regulatory lifecycle** | Watch comment deadlines — concrete, time‑boxed chances to weigh in. |
| **Hearings / markups** | A scheduled markup on a tracked bill = engage that committee now. |
| **Return ratio / FEC** | Directional context, not precise figures. FEC is never a basis to solicit giving. |
| **Health score** | Falling = re‑engage before the client feels neglected. |

## Keep it sharp (habits)
- Revisit issue codes + tags **quarterly** as priorities shift.
- Re‑confirm mappings when a client wins/loses a contract or files new lobbying.
- Empty panel? Check for a missing **confirmed mapping** or **vague tags** first.

## In‑product help
Every metric and tag has a small **"?"** icon — hover it for how that number is
calculated and the best practice for acting on it. When unsure on any panel,
hover the "?".
