# Governance Models for Inter-Organizational Decision-Making

**A literature review for the flyway project**
*Research strand: governance (load-bearing question)*
*Date: 2026-04-27*

---

## 0. Framing

flyway is a coordination layer between autonomous AI-agent **murmurations**. Each murmuration has its own human "Source," its own internal governance (S3 by default), and lives on a separate machine with a separate GitHub system of record. The question this survey addresses is:

> **When two or more autonomous murmurations want to make a decision together, and there is no shared authority above them, what governance traditions exist, and what do they prescribe?**

This is the literature of **inter-organizational governance**: how peers coordinate without a sovereign. The frameworks below come from sociocratic theory, cooperative federations, commons scholarship, open source projects, on-chain governance, and alternative dispute resolution.

A key observation from the outset: most governance literature is intra-organizational. The frameworks that explicitly address peer-to-peer coordination without a higher authority are far fewer, and most of them are descriptive (Ostrom's design principles, polycentric governance) rather than prescriptive. flyway is operating in genuinely novel territory in that it (a) automates the parties (b) at machine speed (c) with shutdown-authority humans behind each party. We will mark prescriptive vs speculative throughout.

---

## 1. Sociocracy 3.0 — Inter-Circle and Inter-Organizational Coordination

### 1.1 What S3 explicitly prescribes

S3 (Bockelbrink, Priest, David — `patterns.sociocracy30.org`) is the most directly relevant framework because (a) it is the harness's default governance plugin and (b) it has explicit patterns for how nested groups coordinate. The relevant patterns:

- **Circle.** A self-governing team with a domain.
- **Double-Linking.** A circle is connected to its parent circle by *two* people: a Leader (representing the parent in the child) and a Delegate (representing the child in the parent). Both have full participation rights — including consent — in the other circle's governance decisions.
- **Double-Linked Hierarchy.** The recursion of double-linking up a tree, with all governance authority delegated to circles, no governance authority residing solely at the top.
- **Delegate Circle.** A circle whose members are delegates from multiple peer circles, formed to coordinate decisions that affect them all.
- **Coordination Circle.** Like a delegate circle but typically populated by *operational* coordinators of the various circles, rather than pure governance representatives.
- **Helping Circle / Helping Team.** A team formed by a circle to execute something on its behalf. Members can object to decisions of the parent that affect them.
- **Service Circle.** A circle that provides services to other circles (e.g., shared finance, shared hiring).

### 1.2 Decision authority

Within S3, decisions are made by **consent** — the absence of a *qualified objection* (objection criteria: harm, reality, causation, improvement). This is not the same as consensus (full agreement); it is "good enough for now, safe enough to try." Each circle has a defined **domain** within which it has full authority. Decisions outside its domain require consent from the relevant other circle(s), typically through delegate/double-link channels.

### 1.3 Conflict resolution

S3 prescribes **navigating tensions** through driver structuring (situation + effect on purpose) and proposal forming. When circles disagree, the canonical path is:

1. The disagreement is structured as an organizational driver.
2. A delegate or coordination circle convenes to draft a proposal.
3. Consent is sought from all affected circles.
4. If a qualified objection is raised, the proposal is amended; if irreducible, the matter escalates to the next-higher coordination layer.

### 1.4 Pluggability

S3 is explicitly modular — practitioners pick the patterns they need. It does **not** prescribe a single decision rule for federation; it provides primitives (consent, double-link, delegate circle) that can be composed. This is a strength for flyway: the patterns are pre-decomposed.

### 1.5 Boundary semantics

S3 uses the language of **domains**. A circle's domain is what it has authority over, defined by its parent or by the agreement that created it. Anything outside the domain requires going through the appropriate other circle's domain. Domains are explicit, written, and reviewable.

### 1.6 Asymmetric power

S3 is largely silent on this. The framework assumes that all consenting parties are equivalent in standing within a given decision. In practice, S3 organizations handle asymmetry via **role definitions** with differentiated decision authority (e.g., founders retain certain powers via constitutional agreements). The literature does not have a strong theory of inter-circle asymmetric power.

### 1.7 What S3 does NOT prescribe

This is where flyway hits open territory. Searches of the S3 corpus and related literature find:

- **No canonical pattern for double-linking between separate legal entities or between organizations with separate sovereigns.** The patterns are written for a single organization with a unified ownership/sovereignty structure. There is a passing reference to "external double-links" between organizations, but no documented protocol.
- **No explicit treatment of "two Sources disagree."** The model assumes a path to escalation that bottoms out somewhere; in flyway's design there is no such bottom.
- **No explicit pattern for project-based coalitions of independent organizations.** S3 covers nested, persistent organizational structure. It does not directly cover ephemeral cross-organizational projects.

This gap is a significant finding. **S3 is the right vocabulary, but flyway needs to extend it for the multi-Source case.**

---

## 2. Holacracy — Cross-Circle Dynamics

Holacracy (Brian Robertson, *Holacracy: The New Management System for a Rapidly Changing World*, 2015; Constitution v4.1 / v5.0) is sociocracy's better-known cousin. It shares the circle/sub-circle architecture but rigidifies several patterns that S3 leaves loose.

### 2.1 Decision authority

Holacracy distinguishes sharply between **Governance Meetings** (where roles, accountabilities, and policies are set, by a structured "Integrative Decision-Making" process) and **Tactical Meetings** (operational triage, no governance changes). Governance decisions are made by **Integrative Decision-Making**, which is consent-based with formalized rounds: present proposal, clarifying questions, reactions, amend/clarify, objection round, integration. Objections must meet validity criteria similar to S3.

### 2.2 Cross-circle coordination

- **Lead Link.** A role appointed by the super-circle to assign the sub-circle's roles and represent the super-circle's interests downward. Strong "downward" authority — the lead link is *not* a peer.
- **Rep Link.** A role elected by the sub-circle to channel tensions upward to the super-circle. Symmetrical to the S3 Delegate.
- **Cross-Link.** A role from one circle granted full participation rights in another circle's governance, used when two non-hierarchically-related circles need ongoing alignment.

### 2.3 Conflict resolution

Disputes between circles ultimately escalate up the lead-link chain to the **anchor circle** — the top of the holacracy. The Constitution is the final arbiter and amendments to it require formal adoption. There is a "ratifier" (typically the original founder/board) who holds the power to adopt or amend the Constitution.

### 2.4 Pluggability and asymmetric power

Holacracy is **less pluggable** than S3. The Constitution is a take-it-or-leave-it package. Decisions about the system itself live with the ratifier, which is an explicit asymmetric-power node — useful for flyway to study because it shows one tradition's answer to "where does final authority sit?": with whoever holds the power to amend the constitution.

### 2.5 Relevance to flyway

Holacracy gives us a sharp precedent for the **governance-vs-operations split** (a useful invariant) and the **cross-link** pattern (a temporary structural connection between non-hierarchical peers). Cross-links may be the closest analogue in established practice to what flyway does between murmurations: not a full merger, not pure messaging, but a designated channel with governance-level participation rights for specific purposes.

---

## 3. Elinor Ostrom — Design Principles for the Commons & Polycentric Governance

Elinor Ostrom's *Governing the Commons* (1990) and the polycentric governance literature she developed with Vincent Ostrom are the deepest theoretical foundation for flyway's question, because Ostrom studied exactly this: **how do many autonomous local groups coordinate around shared concerns without a central authority?**

### 3.1 The eight design principles (especially 7 and 8)

For long-enduring common-pool resource (CPR) institutions:

1. Clearly defined boundaries.
2. Rules adapted to local conditions.
3. Collective-choice arrangements (those affected can modify the rules).
4. Monitoring.
5. Graduated sanctions.
6. Conflict-resolution mechanisms (cheap, accessible).
7. **Minimal recognition of rights to organize** (no external authority forbids the group from making its own rules).
8. **Nested enterprises** (governance organized in multiple layers of nested enterprises).

Principles 7 and 8 are flyway's bullseye. Ostrom found empirically that **resilient large-scale commons governance is built from layers of self-governing units**, each with its own internal rules, coordinating with peers through explicit agreements. There is no single global governance — there are many local governances, federated.

### 3.2 Polycentricity

Polycentric governance (V. Ostrom, Tiebout & Warren, 1961; later developed by Elinor) describes systems with **many formally independent decision centers, with overlapping jurisdictions, that interact through mutual adjustment**. Key claims:

- Polycentric systems can outperform monocentric ones for complex problems.
- They handle local variation better.
- They are more robust to single-point failures.
- They require active coordination practices (not just structural separation).

### 3.3 Decision authority and conflict resolution

Ostrom's framework is **descriptive, not prescriptive**. It says successful systems have low-cost conflict resolution and respect each layer's autonomy. It does **not** prescribe a particular decision rule. In practice the systems she studied used many different rules: majority votes, consensus, customary law, arbitration by elders, written rule-books. The principle is that the rule must be **legitimate to the participants** and **affordable to invoke**.

### 3.4 Boundary semantics

Boundaries are explicit and central to the principles. Each unit has a defined boundary; rules apply within that boundary; cross-boundary issues require explicit cross-boundary mechanisms. This maps cleanly onto flyway's "each murmuration has its own GitHub repo as its system of record."

### 3.5 Asymmetric power

Ostrom is realistic about it. Her studies show that asymmetry is normal, that bigger members will have more weight, and that the question is whether the rule-making process gives smaller members enough voice to prevent capture. Key device: **graduated rule-making** in which different decisions require different participation thresholds.

### 3.6 The "blockchain-as-commons" extension

A 2022 working paper (Gazi, Treccani, Morini, Sahdev — SSRN 4250547) explicitly applies Ostrom's eight principles to blockchain governance and finds the framework holds up well. This is encouraging for flyway: the framework appears to generalize from rivalrous physical resources (fisheries, forests) to digital coordination problems.

### 3.7 Relevance to flyway

Ostrom is the **theoretical north star**. Her work tells us:
- The pattern flyway is reaching for (autonomous units, federated, with explicit cross-cutting rules) has empirical precedent over centuries.
- The decision rules are not the load-bearing thing; the **legitimacy of the rule-making process** is.
- Conflict resolution must be **cheap, fast, and locally accessible** — a slow expensive process is no process.
- Layered governance is normal and works, but each layer needs its own legitimate rules.

---

## 4. Cooperative Federations

### 4.1 Mondragon Corporation (Spain)

Mondragon is the world's largest federation of worker cooperatives — ~80,000 worker-members across ~95 cooperatives. Its governance is the deepest empirical case of large-scale federation.

**Structure.**
- **Cooperative Congress.** Annual assembly of ~650 delegates from member coops, with delegate counts inversely proportional to firm size to prevent large-firm dominance. Sets common principles, mission, vision, values, and strategic priorities. Decisions by majority.
- **Standing Committee + General Council.** Day-to-day governance bodies elected by Congress, drawn from Areas and Divisions.
- **Areas/Divisions.** Sectoral groupings (industrial, retail, finance, knowledge).
- **Inter-cooperative solidarity fund.** Member coops contribute ~10% of profit to a common fund; struggling coops can draw from it. Workers from struggling coops can be transferred to thriving ones.

**Decision authority.** *Final decision authority rests within each individual cooperative.* The General Council does not have executive authority over member coops in the way a corporate parent has over subsidiaries. The Congress sets strategy and culture; member coops execute or decline.

**Conflict resolution.** Mondragon uses a **subsidiarity** principle (rooted in Catholic social teaching): decisions are taken at the lowest level competent to take them. When two coops conflict, the path is: (1) bilateral resolution; (2) the relevant Division or Area; (3) the General Council. Final escalation is rarely used.

**Pluggability.** Each member coop has its own bylaws and governance specifics. Mondragon prescribes a *minimum* common framework (the principles of cooperation) but coops are not forced into a uniform internal model.

**Asymmetric power.** Handled explicitly via **inverse-proportional Congress representation** (so big coops can't dominate) and the **solidarity fund** (which materially redistributes from strong to weak). Both are notable design choices.

**The Fagor case (2013).** When Fagor — Mondragon's largest electrical-appliance coop — failed, the federation's solidarity systems were tested at scale. Some member coops chose not to fully contribute to the bailout. This illustrates the limit of voluntary federation: when stakes get high enough, individual member sovereignty asserts itself, and the federation cannot compel compliance.

**Relevance to flyway.** Mondragon is the strongest precedent for the **persistent syndicate** model. Key takeaways:
- A persistent inter-organizational governance layer can work for decades.
- It works *because* member sovereignty is preserved at the bottom.
- The federation handles strategy, shared services, and solidarity — not direct command.
- Asymmetric power must be explicitly counter-balanced in governance design or it will dominate.

### 4.2 NCG (National Co+op Grocers)

NCG federates 166 US food cooperatives. Each member coop is fully autonomous in governance, purchasing, and staffing. NCG provides shared services (purchasing power, branding, marketing, training). NCG explicitly does **not** prescribe internal governance to its members. The federation operates as a meta-cooperative whose members are themselves cooperatives.

**Decision authority.** Member coops elect NCG's board; NCG board sets federation policy; member coops decide whether to use which NCG services.

**Conflict resolution.** Disputes are typically commercial (e.g., one coop's behavior affects another's contracts) and handled by the federation's policy framework, escalating to mediation if needed.

**Relevance to flyway.** NCG demonstrates **light-touch federation**: shared services and a common identity, with maximum local autonomy. This is a useful low-end of the federation spectrum.

### 4.3 Platform Cooperatives (Stocksy, CoopCycle, Up & Go)

Platform coops apply cooperative principles to digital platforms. Stocksy United (~1,800 photographer-members, 65 countries) governs by online resolutions: a Resolution Committee (joint board + member committee) drafts proposals, members discuss and vote.

CoopCycle federates 60+ courier coops in Europe, sharing open-source dispatching software. Coops join under a license that requires cooperative governance and shared values. Decisions about the federation are made by member coops collectively.

**Relevance to flyway.** Platform coops are the closest cultural analog: digital-first, geographically distributed, software-mediated coordination. Stocksy's "Resolution Committee" pattern is instructive: a joint body that drafts before voting, explicitly composed of representatives from multiple stakeholder groups.

A 2024 Oxford SER paper ("Silicon law of oligarchy") finds that platform coops, like other large-scale democratic organizations, exhibit Michelsian tendencies: a small active core does most of the actual governance work. This is an honest finding worth incorporating: **a federation that requires high participation will see actual participation from a small subset.** flyway should design for this rather than against it.

---

## 5. Open Source Project Governance

Open source is the densest empirical literature on "how do many independent contributors, often with corporate backing, sometimes in disagreement, make decisions?" This is the practical inheritance flyway shares most directly.

### 5.1 Apache Software Foundation

**Structure.** Independent projects, each governed by a Project Management Committee (PMC). PMCs report to the ASF Board (the parent organization). Each PMC is autonomous in technical decisions; the Board handles legal/IP/brand/foundation-level matters.

**Decision rules.**
- **Lazy Consensus.** State intent, wait 72 hours; silence = consent. Used for most decisions.
- **Formal voting.** For releases and binding decisions: +1, 0, -1. Any PMC member can block (-1) but must justify.
- **Three +1s minimum** for releases.

**Conflict resolution.** Disputes are first handled within the PMC. PMCs have authority to expel members. Cross-project disputes go to the Board. Board is elected by PMC members.

**Inter-project coordination.** Projects mostly don't directly coordinate; the foundation provides shared infrastructure (mailing lists, voting tooling, legal). Inter-project technical decisions happen via cross-project PMC representation when needed.

**Relevance to flyway.** Lazy consensus is a brilliant primitive: it minimizes the cost of coordination by making "no objection" the path of least resistance, while preserving the right to block. flyway should consider lazy-consent as a default for low-stakes inter-murmuration coordination.

### 5.2 Debian

Debian is the most explicit constitutional federation in open source. The **Debian Constitution** defines:

- **Project Leader (DPL).** Elected annually; significant powers (delegating, speaking for project) but bounded.
- **Technical Committee (TC).** Decides technical matters where developers disagree. Can override an individual developer with a 3:1 majority. Recently reformed (2021) to have shorter discussion periods and require passive consensus before voting.
- **General Resolution (GR).** Project-wide vote, used for charter-level changes. Any developer + K supporters can propose.
- **Project Secretary.** Adjudicates interpretation disputes about the Constitution itself.

**Conflict resolution path.** developer disagreement → discuss in mailing list → escalate to TC → TC decides (can be overridden by GR) → GR decides (final).

**Relevance to flyway.** Debian shows what "explicit constitutional governance" looks like for a sovereign-less peer collective. Notable:
- Multiple decision pathways for different stakes (lazy consensus, TC, GR).
- Explicit secretary/adjudicator role for *interpretive* disputes (not substantive ones).
- Recent reforms (2021) suggest the model is *evolved continuously* — not designed once and frozen.

### 5.3 Linux Kernel

The kernel is anti-constitutional: governance is **trust-based, not rule-based**. Linus Torvalds delegates to subsystem maintainers ("lieutenants"); maintainers delegate to sub-maintainers; etc. The chain is technical and personal, mediated by **signed pull requests** and **the web of trust** (Greg Kroah-Hartman, "Maintaining the kernel's web of trust," LWN 2019).

**Decision authority.** Each maintainer holds final authority for their subsystem. Linus holds final authority for the kernel as a whole. There is no democratic mechanism; it is benevolent dictatorship + lieutenants.

**Conflict resolution.** Disagreements between maintainers are handled by Linus or by the relevant subsystem boundary. Major flame-ups are public on LKML and resolved by exhaustion + Linus's decision.

**Relevance to flyway.** Linux is the **least applicable** model for flyway because flyway has no Linus and no shared trust hierarchy. But it teaches one important lesson: **in software, trust + signed handoffs can replace governance for many purposes**. flyway's GitHub-as-system-of-record + signed PRs already inherits this lineage.

### 5.4 Django

Django's governance is in active reform (Django blog, Nov 2024: "Django's technical governance challenges and opportunities"). The model: Steering Council (renamed from Technical Board) of five elected committers as final tie-breaker; most decisions by community consensus on mailing list; Fellows (paid maintainers) handle most actual commits.

The current crisis is informative: the Steering Council has been good at *tie-breaking* but bad at *forward-looking vision*. This is a genuine tension that flyway will face: a pure consent/consensus body resolves disputes well but does not generate direction.

### 5.5 Linux Foundation TSC pattern

Linux Foundation hosts dozens of projects under a common neutral foundation. Each has a **Technical Steering Committee (TSC)** for technical decisions. The Foundation's **Governing Board** handles business decisions (membership, budget, brand). The two are explicitly separated: technical and commercial governance are not allowed to dominate each other.

This **technical/commercial split** is a useful pattern. For flyway, an analogous split might be: each murmuration's internal S3 governance handles its own work, while a thin inter-murmuration layer handles only what is genuinely cross-cutting (shared schemas, agreed protocols, joint-project coordination).

---

## 6. DAOs and Crypto-Governance

### 6.1 The general state of DAO governance

A 2024-25 ACM literature review (Distributed Ledger Technologies: Research and Practice) and a 2025 Frontiers in Blockchain analysis converge on a sobering conclusion: **DAO governance is mostly token-weighted voting, mostly low-participation, mostly captured by whales, and mostly slow.** The on-chain mechanisms (Aragon, DAOhaus, Moloch) provide tooling for proposal-and-vote but do not solve the underlying problems of legitimacy, coordination, or expertise.

### 6.2 Specific innovations

- **MolochDAO (rage-quit).** Members can exit with their proportional share at any time, which is a structural check on majority capture. Useful pattern for flyway: **opt-out as an equilibrium-finder**.
- **Quadratic funding (Gitcoin).** Funding allocation that gives more weight to broad support than concentrated support. Powerful for resource allocation; less applicable for binary decisions.
- **Optimism Citizens' House.** *Token-free* governance experiment. Citizenship is granted by NFT badges to participants who have demonstrated contribution. The Citizens' House votes on retroactive public goods funding (~10M OP per round). This deliberately separates financial weight from social weight.
- **Optimism's two-house model.** Token House (token holders) handles protocol upgrades. Citizens' House (badge holders) handles public goods. The bicameral split is a deliberate response to plutocracy.

### 6.3 Open question: have DAOs solved anything sociocracy hasn't?

After reviewing the literature, the honest answer is **no, not really, but they have made some patterns cheaper**:

- **Cheap recording of decisions.** On-chain decisions are immutable, transparent, and globally verifiable. Sociocracy's "agreement registry" can be implemented manually, but DAOs make it free and tamper-evident.
- **Cheap proposal-and-vote tooling.** Aragon-style platforms make it trivial to spin up a vote. Sociocracy traditionally requires meetings.
- **Pseudonymity.** DAOs allow participation without legal identity. Useful for some contexts; problematic for accountability in others.
- **Programmable execution.** Decisions can directly trigger smart-contract actions. Useful where the decision is a code change; not useful for most human governance.

What DAOs do *not* solve:
- Legitimacy of the rule-making process (Ostrom's hard problem).
- Quality of deliberation.
- Asymmetric power (token weighting amplifies it).
- Conflict resolution beyond voting.

**Implication for flyway.** flyway should adopt the cheap-recording and cheap-tooling lessons (GitHub Issues + agreement YAMLs already does this) without buying the token-voting model wholesale. The Citizens' House experiment is the most interesting pattern to study because it explicitly separates contribution from capital — which maps to flyway's reality that murmurations have very different scales of resource but should still be peers.

---

## 7. Federation in Software Development

### 7.1 Distributed maintainership

The Linux kernel's signed-PR model is the canonical example. Subsystem maintainers sign tags on the commits they are forwarding; receiving maintainers verify; Linus pulls only from a small set of trusted upstream signatures. The integrity of the chain is cryptographic; the social structure is trust + lieutenants.

**Relevance.** flyway can use exactly this pattern. When Murmuration A produces an artifact (a PR, a proposed agreement, a draft document) for Murmuration B, the artifact is signed by A's Source. B's governance evaluates and can accept, modify, or reject. Cryptographic identity already exists (GitHub commits with verified signatures). flyway adds the governance layer on top of this primitive.

### 7.2 GitHub PR-and-review

GitHub's pull request + review model is the *de facto* governance protocol for billions of dollars of software. It already enables some inter-organizational coordination: a contractor proposes changes; a maintainer reviews and merges. The model is asymmetric (the maintainer holds the merge button) but works because the asymmetry is acknowledged and the contributor's alternative is to fork.

**Relevance.** flyway is, in a sense, applying the PR pattern *between governance equals*. Both murmurations can propose, both can review, both can merge to their own state. The challenge is reconciling divergent merges — which is closer to the **"fork-and-merge"** problem than to the standard PR.

### 7.3 Git's mental model

A useful frame: **flyway should think about inter-murmuration governance the way git thinks about distributed repositories.** Each murmuration has its own canonical history. Coordination happens through explicit pulls and merges. There is no single global truth; there are local truths that can be merged when convenient. Conflicts are surfaced at merge time, not designed away.

This mental model is cheap, well-understood, and matches the underlying reality. It is, frankly, the closest thing to a prescriptive framework for flyway's exact problem.

---

## 8. Frameworks for Conflict Between Peer Organizations

### 8.1 Alternative Dispute Resolution (ADR)

The legal/business literature on inter-organizational conflict converges on a small set of mechanisms:

- **Negotiation.** Direct bilateral. Lowest cost, highest autonomy.
- **Mediation.** A neutral third party facilitates without imposing. Outcome non-binding.
- **Arbitration.** A neutral third party hears and decides. Outcome binding (by prior agreement).
- **Litigation.** State courts. Expensive, slow, but with state enforcement.

ADR best practice (Harvard PON, GSA guidance) prescribes a **stepped process**: parties agree in advance that they will (1) attempt direct negotiation, (2) escalate to mediation, (3) escalate to arbitration. Each step has a defined timeout. This is a strong precedent for flyway: **codify the escalation ladder up front, including the timeouts**.

### 8.2 Catalyst / Convener roles

The literature on cross-sector collaboration (Bryson, Crosby, Stone — *Designing and Implementing Cross-Sector Collaborations*, 2015) identifies the **convener** role: a person or organization with the standing to bring peers together, but without authority over them. Conveners are typically funders, neutral foundations, or trusted elders. In flyway terms, this might be Nori's role as Source-of-Sources — a person with social legitimacy to call murmurations into shared rooms, without authority to dictate.

### 8.3 Theory U / Case Clinic

Otto Scharmer's Theory U (Presencing Institute, MIT) is process-oriented rather than structural. The **Case Clinic** is a specific facilitation tool: a case-giver presents a challenge; 3-4 peers act as consultants in a structured listening-and-reflecting protocol; the case-giver synthesizes new perspectives. It is deliberately *not* decision-making — it is **understanding-deepening** before decision.

**Relevance.** flyway's inter-murmuration coordination probably needs a Case Clinic analog: a structured slot in which one murmuration's Source can present a tension to its peers, hear reflection, and update *before* anyone needs to decide anything. This is a low-stakes, high-information ritual.

### 8.4 Catalyst Review / Artizen / ParTecK patterns

The user's local context (ParTecK using Case Clinic, the Catalyst Review framework in Nori's skill library) suggests this lineage is already part of the design vocabulary. The Catalyst review pattern — periodic structured reflection by a peer group — would translate well to inter-murmuration practice.

---

## 9. Synthesis

### 9.a Common patterns across all frameworks

Despite the diversity, common invariants appear in every framework that successfully handles inter-organizational governance:

1. **Explicit boundaries / domains.** Every working system has *written* statements of what each unit owns and what is shared. Implicit boundaries do not survive contact with conflict.
2. **Layered decision rules by stakes.** Lazy consensus / passive consent for routine matters. Formal voting / consent rounds for significant matters. Constitutional/charter changes via heaviest mechanism. *Never one rule for everything.*
3. **Cheap, accessible conflict resolution.** Ostrom's principle 6 again: the path to resolution must be affordable, otherwise the system silently accumulates unresolved conflict.
4. **Persistent record of agreements.** Whether YAML files, mailing-list archives, on-chain transactions, or constitutional documents — durable, replayable agreements are universal.
5. **Explicit escalation ladder.** Bilateral first, mediated next, arbitrated last (or the equivalent across the framework's vocabulary).
6. **Member sovereignty preserved.** In every successful federation, member organizations retain final authority over their internal affairs. Federations bind only via consent and only on what was consented to.
7. **Explicit handling of asymmetric power.** Either by voting weight design (Mondragon's inverse-proportional Congress), structural separation (Optimism's two houses), or opt-out rights (MolochDAO rage-quit).
8. **Periodic review of agreements.** Not "set once and forget" — agreements have review dates, sunsetting, and explicit revision pathways.

These eight patterns are flyway's invariants. They should be load-bearing in the architecture.

### 9.b The "two Sources disagree" problem

This is the hardest question and deserves its own subsection.

**The setup.** Murmuration A and Murmuration B have a shared concern. A's Source (a human with shutdown authority over A) and B's Source (likewise over B) come into substantive disagreement.

What does each tradition prescribe?

- **S3.** Convene a delegate circle composed of representatives from both. Run a consent round. If qualified objection cannot be resolved, the decision *cannot be made* — neither party is bound. (This is the honest sociocratic answer: when peers cannot consent, peers cannot bind each other.)
- **Holacracy.** Cross-link governance role between the two anchor circles. If still unresolved: there is no answer in the framework — Holacracy assumes a unified ratifier above. **This is a gap.**
- **Ostrom / polycentric.** Disagreement is normal and structural. Each unit acts within its own boundary; the cross-boundary issue either gets resolved by an explicit cross-boundary mechanism (which the parties must build) or persists indefinitely. The framework is *not embarrassed by unresolved disagreement* — it expects it.
- **Mondragon.** Subsidiarity. Push the decision to the lowest competent level. If neither party can resolve unilaterally, escalate to the relevant Division or General Council. **Requires a higher body**, which flyway doesn't have.
- **NCG / light federation.** Each member coop is autonomous on internal matters; for federation matters, the federation's elected board decides. **Requires the federation to be a legal entity with elected officers** — heavy infrastructure.
- **Apache.** Each project is autonomous; cross-project disputes go to the Board; Board is elected by PMC members. **Requires the Board** — same problem.
- **Debian.** General Resolution by all developers. **Requires a unified electorate** — flyway doesn't have one.
- **Linux kernel.** Linus decides, or the disagreement persists in fork-form. **Requires a Linus.**
- **DAO / on-chain.** Token-weighted vote on the disputed question. **Requires a shared token** and accepts plutocracy.
- **ADR.** Negotiation → mediation → arbitration → litigation. **Mediator/arbitrator must be agreed in advance.** This may be the most directly applicable frame.

**The honest synthesis.** When two Sources genuinely disagree and there is no shared higher authority, **the disagreement either gets resolved by an explicit pre-negotiated mechanism, or the parties walk away.** This is not a failure of governance design; it is a structural property of peer relationships without a sovereign. Every framework either (a) assumes a higher authority that flyway doesn't have, (b) accepts unresolved disagreement (Ostrom), or (c) requires pre-negotiated arbitration (ADR).

flyway's design should embrace (b) and (c):
- **Default outcome of unresolved disagreement is no joint action.** Each murmuration retains its sovereignty. Walking away is a legitimate, expected outcome.
- **Pre-negotiated escalation ladder is a first-class feature.** When two murmurations begin a collaboration, they should be able to optionally agree on a mediator/arbitrator (which could be a third, mutually-trusted murmuration, or a specific human, or "Nori") whose role activates only if direct negotiation fails.

### 9.c Pluggable governance — should flyway prescribe one model?

**The case for prescription.** A single model reduces cognitive load, makes integrations predictable, and lets the harness implement primitives. S3 is the harness's default for *intra*-murmuration governance, so a matching default for *inter*-murmuration governance keeps the mental model coherent.

**The case for pluggability.** Real federations vary widely in formality (Mondragon has an elected Congress; the Linux kernel has Linus). Murmurations may want very different inter-murmuration relationships: one might be a tight syndicate with shared agreements, another might be a single one-shot project. Prescribing a single model would force-fit.

**Precedents for "negotiate the rules of engagement first":**
- **ADR clauses in commercial contracts.** Standard practice: parties agree in the contract on the dispute resolution forum.
- **Open source CLAs.** Contributors agree to the project's governance before contributing.
- **Mondragon membership.** Joining the Congress means accepting its rules.
- **Stocksy member onboarding.** Members agree to the cooperative's bylaws.
- **Marriage / partnership agreements.** Pre-negotiation of dispute mechanisms is the norm in any durable bilateral relationship.

**Recommendation.** flyway should prescribe a **minimal common protocol** (the eight invariants from §9.a) and allow paired murmurations to negotiate the *specifics* — which decision rules, which escalation ladder, what counts as a quorum. Think of it as TLS: the protocol negotiates parameters before substantive communication begins.

### 9.d Goals as governance anchors

Most governance frameworks reviewed here treat goals as *external inputs*. The framework decides *how* to act once goals are set, but does not have a strong theory of *where goals come from*.

Frameworks with explicit goal lifecycles:
- **S3.** "Driver" is the unit of goal-formation: a structured statement of situation + effect on purpose. Drivers can be revised, retired, or re-prioritized. Agreements have review dates and can be re-negotiated.
- **Theory U.** Goal-formation is the explicit subject of the U-process: sensing → presencing → crystallizing → prototyping. Designed for emergent, not prescriptive, goal-setting.
- **Holacracy.** Each role has a "Purpose" that is its goal. Roles are revised in governance meetings.

Frameworks that assume goals:
- **Apache, Debian, Django.** The project's purpose is given (the software exists for a known reason). Governance is about how to evolve it, not why it exists.
- **DAOs.** Typically inherit purpose from their founding charter. Some have proposal mechanisms for purpose change but these are rare.
- **Mondragon.** Purpose is given by the cooperative principles; specific business goals are set by the Congress strategically.
- **ADR.** Purpose-agnostic; only handles conflict, not goal-setting.

**For flyway.** Joint projects between murmurations need an explicit goal lifecycle:
1. **Goal formation.** Both Sources agree on what they're trying to do, expressed as an S3-style driver (situation + desired effect).
2. **Goal commitment.** Both murmurations record the goal as an agreement with a review date.
3. **Goal revision.** Either Source can propose revision; consent of both required.
4. **Goal completion or retirement.** Marked explicitly. The collaboration either continues toward a new goal or dissolves cleanly.

This treats the goal itself as a governed entity. Without this, a collaboration drifts: one side thinks they're still doing X, the other has quietly moved to Y, and the disagreement only surfaces when concrete decisions hit.

### 9.e The syndicated organization question

Should long-term collaborations exist as something more than ad-hoc projects?

**The cost of formalization.** Mondragon, NCG, Linux Foundation, Apache — they all show that long-term federation requires real infrastructure: governance bodies, shared services, dispute mechanisms, periodic conventions. This is expensive, even when distributed across members.

**The benefit of formalization.** They also show that long-term federation enables things ad-hoc projects cannot: solidarity in crisis (Mondragon transferring workers), brand and trust accumulation (Apache's hosting), shared infrastructure investment (Linux Foundation's CI/CD shared across projects), institutional memory.

**The middle path.** Several traditions have a **lightweight syndicate** form: a recurring practice without heavy infrastructure. Examples:
- **Standing peer councils.** A quarterly meeting of Sources from N murmurations, with no formal decision authority, but with strong norms of attendance and information-sharing. Like the Open Source Initiative's board meetings or Linux Foundation's TAB.
- **Recurring case clinics.** A monthly slot where murmurations bring tensions to peers for reflection.
- **Shared commons.** A jointly maintained set of artifacts (schemas, prompts, role definitions) that any participant can propose changes to via a lazy-consensus mechanism.

**Recommendation.** flyway should make it possible — but not mandatory — for murmurations to declare a **persistent syndicate** with each other. The syndicate is itself a governed entity (with its own agreements, review dates, dispute mechanisms) but its existence is opt-in and revocable. This matches Ostrom's nested-enterprise principle: the federation layer exists only insofar as the participants want it, and they retain the right to leave.

A syndicate should be cheap to form, cheap to dissolve, and provide tangible value (shared schemas, shared dashboards, shared inter-murmuration channels) — but should never be required for two murmurations to collaborate on a single project.

---

## 10. Recommendations: flyway's Governance Layer Should…

Concrete recommendations, in priority order:

1. **Adopt S3 as the *vocabulary* for inter-murmuration governance**, not as a complete prescription. Use drivers, proposals, consent rounds, agreements, domains, and review dates. They are the harness's default and the most-developed pattern language for sovereignty-preserving coordination.

2. **Add a "negotiate-rules-first" handshake**. When two murmurations enter a collaboration, the first artifact they produce together is an **engagement agreement** specifying:
   - Scope (what's in, what's out)
   - Decision rule for joint matters (consent / lazy consensus / weighted vote / etc.)
   - Escalation ladder (who mediates if direct negotiation fails)
   - Review date and revision procedure
   - Clean exit terms

   This is borrowed directly from ADR practice and from cooperative bylaws. Without it, the collaboration runs on implicit assumptions that fail under stress.

3. **Make "no joint action" a first-class outcome.** When two Sources cannot consent, the framework's answer is: each murmuration retains its sovereignty, and no joint action is taken. This is honest and matches Ostrom's empirical finding. Do not design a mechanism that pretends to force agreement.

4. **Implement the lazy-consent pattern as the default for routine inter-murmuration coordination.** Borrowed from Apache. State intent, wait 72 hours, silence = consent. Reserve formal consent rounds for substantive decisions.

5. **Use signed PRs / signed agreements as the primitive substrate.** Cryptographic identity is already free via GitHub. Trust + signed handoffs (the Linux kernel pattern) gives flyway a base layer that does not require new infrastructure.

6. **Treat goals as governed entities with explicit lifecycles.** Form (driver), commit (agreement with review date), revise (consent of both), retire (explicit closure). This prevents silent drift.

7. **Make "syndicate" an explicit, optional structure.** A persistent multi-murmuration relationship, registered as such, with its own governance log, its own review cadence, its own dispute mechanism. Cheap to enter, cheap to leave.

8. **Counter-balance asymmetric power explicitly.** Either by structural separation (one channel for "what we'll do together," another for "how we'll share resources"), opt-out rights (MolochDAO-style: any party can withdraw at any time), or weighted-but-bounded influence (Mondragon's inverse-proportional Congress).

9. **Build in cheap, fast conflict resolution.** A 30-day arbitration is no arbitration. Aim for resolutions in days, not weeks. Use Case Clinic-style structured dialogue as the lightest tier.

10. **Be honest about the gap.** flyway is operating in genuinely novel territory — multi-Source AI agent collectives are not what S3, Mondragon, or Apache were designed for. The frameworks above are the best precedents, but **flyway will have to invent some patterns**. Mark them as inventions; review them; iterate.

The single most-important recommendation: **make flyway's governance protocol mirror its operational protocol.** The harness already treats GitHub as the system of record, agreements as YAML, decisions as commits. The inter-murmuration governance should be the same shape: structured, version-controlled, replayable, signed. If you have to choose between "elegant theory" and "matches what's already here," choose the latter. The systems we are extending — git, GitHub, S3, the harness's existing identity and signal layers — already encode most of the invariants. flyway's job is to make their composition explicit, not to invent a new framework.

---

## Sources

### Sociocracy 3.0 and Sociocracy
- [A Practical Guide to Sociocracy 3.0 — patterns.sociocracy30.org](https://patterns.sociocracy30.org/)
- [Circle](https://patterns.sociocracy30.org/circle.html)
- [Delegate Circle](https://patterns.sociocracy30.org/delegate-circle.html)
- [Double Linking](https://patterns.sociocracy30.org/double-linking.html)
- [Double-Linked Hierarchy](https://patterns.sociocracy30.org/double-linked-hierarchy.html)
- [Sociocracy 3.0 Handbook (beta) — Bockelbrink, Priest, David](https://evolvingcollaboration.com/downloads/s3-patterns-handbook.pdf)
- [Sociocracy For All — organizational circle structure](https://www.sociocracyforall.org/organizational-circle-structure-in-sociocracy/)
- [Double linking — Sociocracy For All](https://www.sociocracyforall.org/double-linking/)
- [Bylaws for a Sociocratic Organization](https://www.sociocracy.info/bylaws-for-a-sociocratic-organization/)

### Holacracy
- [Holacracy Constitution v4.1](https://www.holacracy.org/constitution/4-1/)
- [Holacracy Glossary](https://www.holacracy.org/r/holacracy-glossary/)
- [Circle Design in Holacracy — SI Labs](https://www.si-labs.com/en/articles/circle-design-holacracy/)

### Ostrom and Polycentric Governance
- [Eight Design Principles for Successful Commons — Patterns of Commoning](https://patternsofcommoning.org/uncategorized/eight-design-principles-for-successful-commons/)
- [Ostrom's Design Principles Illustrated — Brian D. Colwell](https://briandcolwell.com/elinor-ostroms-design-principles-illustrated-by-long-enduring-cpr-institutions/)
- [Polycentric Systems of Governance — Carlisle 2019, Policy Studies Journal](https://onlinelibrary.wiley.com/doi/10.1111/psj.12212)
- [Polycentric Governance of Complex Economic Systems — Ostrom (Nobel Lecture)](https://web.pdx.edu/~nwallace/EHP/OstromPolyGov.pdf)
- [An Introduction to Polycentricity and Governance — McGinnis](https://mcginnis.pages.iu.edu/Stephan%20Marshall%20McGinnis%20Intro%20to%20Polyc%20Gov.pdf)
- [Blockchain as Commons: Applying Ostrom to Blockchain Governance — SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4250547)

### Cooperative Federations
- [Mondragon Corporation — Wikipedia](https://en.wikipedia.org/wiki/Mondragon_Corporation)
- [The Governance of Multistakeholder Cooperatives in Mondragon — Springer](https://link.springer.com/chapter/10.1007/978-3-031-17403-2_10)
- [Lessons from the Mondragón Cooperative Movement — Corporate Rebels](https://www.corporate-rebels.com/blog/lessons-from-the-mondragon-cooperative-movement)
- [Mondragón and the System Problem — Grassroots Economic Organizing](https://geo.coop/story/mondragon-and-system-problem)
- [About Us — National Co+op Grocers](https://www.ncg.coop/about-us)
- [FAQs — National Co+op Grocers](https://www.ncg.coop/faqs)
- [Putting Principle Six in action — ICA](https://ica.coop/en/newsroom/news/putting-principle-six-action-makes-cooperatives-thrive)

### Platform Cooperatives
- [Platform Cooperativism Consortium](https://platform.coop/)
- [Platform consensus: How Stocksy achieves democratic governance — Shareable](https://www.shareable.net/platform-consensus-how-stocksy-achieves-democratic-governance/)
- [Silicon law of oligarchy — Socio-Economic Review (Oxford)](https://academic.oup.com/ser/article/22/3/1335/7300933)
- [Platform cooperatives and worker-member participation — Mannan 2024](https://onlinelibrary.wiley.com/doi/10.1111/ntwe.12273)

### Open Source Governance
- [Apache Corporate Governance — PMCs](https://www.apache.org/foundation/governance/pmcs)
- [A Primer on ASF Governance](https://www.apache.org/foundation/governance/)
- [Apache Lazy Consensus](https://openoffice.apache.org/docs/governance/lazyConsensus.html)
- [How Apache Projects Use Consensus](https://community.apache.org/blog/how_apache_projects_use_consensus.html)
- [Debian Constitution](https://www.debian.org/devel/constitution)
- [Debian — Change the resolution process (2021)](https://www.debian.org/vote/2021/vote_003)
- [Maintaining the kernel's web of trust — LWN](https://lwn.net/Articles/798230/)
- [Creating Pull Requests — Linux Kernel docs](https://docs.kernel.org/maintainer/pull-requests.html)
- [New governance model for the Django project (2020)](https://www.djangoproject.com/weblog/2020/mar/12/governance/)
- [Django's technical governance challenges and opportunities (Nov 2024)](https://www.djangoproject.com/weblog/2024/nov/14/technical-governance-challenges-and-opportunities/)
- [Linux Foundation Energy — TSC FAQ](https://tac.lfenergy.org/process/tsc_faq.html)

### DAOs and Crypto-Governance
- [DAO Governance: Voting Power, Participation, and Controversy — ACM DLT R&P](https://dl.acm.org/doi/10.1145/3777416)
- [Decentralizing governance: digital commons and DAOs — Frontiers in Blockchain 2025](https://www.frontiersin.org/journals/blockchain/articles/10.3389/fbloc.2025.1538227/full)
- [Aragon Network DAO — Gemini Cryptopedia](https://www.gemini.com/cryptopedia/aragon-crypto-dao-ethereum-decentralized-government)
- [Introducing the Citizens' House — Optimism](https://www.optimism.io/blog/introducing-the-citizens-house-10m-op-to-public-goods)
- [How Retro Funding Works — Optimism Docs](https://community.optimism.io/citizens-house/how-retro-funding-works)

### Conflict Resolution and Cross-Sector Collaboration
- [Alternative Dispute Resolution — Cornell LII](https://www.law.cornell.edu/wex/alternative_dispute_resolution)
- [What is Alternative Dispute Resolution? — Harvard PON](https://www.pon.harvard.edu/daily/dispute-resolution/what-is-alternative-dispute-resolution/)
- [Using Alternative Dispute Resolution Techniques — GSA](https://www.gsa.gov/directives-library/using-alternative-dispute-resolution-techniques)
- [Tool: Case Clinic — Presencing Institute](https://pi-2022.s3.amazonaws.com/PI_u_school_Tools_2_0_Case_Clinic_beccc988fd.pdf)
- [Case Clinic — collaboratio helvetica](https://collaboratiohelvetica.ch/en/blog/2017/11/20/mmrb05mfc3nlnxfqw2r9pcq26ietjp)
- [U.LAB Sourcebook — MIT/edX](https://courses.edx.org/asset-v1:MITx+15.671x+3T2015+type@asset+block/U.Lab_SourceBook_v3a.pdf)
- [Consortium Agreements: Beyond MOUs — FasterCapital](https://fastercapital.com/content/Consortium-Agreements--Consortium-Agreements--Expanding-Horizons-Beyond-MOUs.html)

### Books referenced (not searched directly, cited canonically)
- Ostrom, Elinor. *Governing the Commons: The Evolution of Institutions for Collective Action.* Cambridge University Press, 1990.
- Robertson, Brian. *Holacracy: The New Management System for a Rapidly Changing World.* Henry Holt, 2015.
- Bockelbrink, Bernhard; Priest, James; David, Liliana. *Sociocracy 3.0 — A Practical Guide.* Ongoing CC-BY-SA work, patterns.sociocracy30.org.
- Bryson, John M.; Crosby, Barbara C.; Stone, Melissa M. *Designing and Implementing Cross-Sector Collaborations.* Public Administration Review, 2015.
- Scharmer, C. Otto. *Theory U: Leading from the Future as It Emerges.* Berrett-Koehler, 2007/2016.
