# Gridline GTM application: system design (AADL)

| | |
|---|---|
| Notation | AADL v2 textual (SAE AS5506, Architecture Analysis & Design Language). "ASD 86" is not a standard name I could find, so I read it as AADL, the aerospace architecture specification language. |
| Scope | The GTM application as built on 2026-10-05: `gtm-engine/`, `apps/outreach/` (Outreach Studio), `output-demand/` (demand outreach build, v5 at top level), and the external services they touch. `output/` and `output-demand/` hold a real instance's prospect data and are not in this repository; components that reference them describe how a deployment wires up. |
| Status | Describes current code. Planned parts appear only in section 9, as abstract components with `Status => Planned`. |
| Checked against | Source files listed in each component's `Source_File` property. The model has not been run through an AADL tool (OSATE). |

## 1. Context

```text
                         +----------------------------- Founder (operator) ------------------------------+
                         |  CLI (bun run map / funnel)   browser   Claude Code session   LinkedIn composer |
                         +------+-------------------+--------------+--------------------+------------------+
                                |                   |              |                    | manual send only
          +---------------------v-----+   +---------v----------+   |                    v
          | gtm-engine  127.0.0.1:4320|   | Outreach Studio    |   |              LinkedIn (no API use)
          |  Market_Map process       |   | 127.0.0.1:4310     |   |
          |  Funnel process           |   |  Executor          |   |
          |  market-map.sqlite        |   |  workspace.sqlite  |   |
          |  funnel.sqlite            |   +--+-----+-----+-----+   |
          +--+-------+---------+------+      |     |     |         |
             |       |         ^             |     |     +--> SMTP mailbox (live mode only)
   claude -p |  fxtwitter      | tracker     |     +--------> Partner forms via Playwright (live, mapped only)
             v       v         | rows        +--------------> OpenAI Responses API (research, optional)
       Claude Code  X post     |                    ^
       (web search)            |                    | XLSX export (read-only)
                               |              Google Sheet tracker
          +--------------------+--------------------------------------+
          | claude.ai artifact stores (written by Claude Code via ArtifactData) |
          |  Market map page: companies, runs, meta | submissions      |
          |  Demand outreach page: done, sent, stage                   |
          +-------------------------------------------------------------------+
                               ^
                               | build.py -> demand-outreach.json / .html / demand-crm.csv
                         output-demand/ (v5)
```

Gtm-engine and Outreach Studio share no code, port, or database. Today, the only path between them is the founder.

## 2. Property set

```aadl
property set GTM_Properties is
  Source_File   : list of aadlstring applies to (all);
  Runtime       : enumeration (Bun, Python, Claude_Code, Browser, Hosted) applies to (system, process, abstract, device);
  Bind_Address  : aadlstring applies to (system, process);
  Listen_Port   : aadlinteger applies to (system, process);
  Storage_Path  : aadlstring applies to (data);
  Gitignored    : aadlboolean applies to (data);
  Holds_PII     : aadlboolean applies to (data);
  Append_Only   : aadlboolean applies to (data);
  Sole_Writer   : aadlstring applies to (data);
  Invariant     : list of aadlstring applies to (all);
  Cost_Per_Run  : aadlstring applies to (all);
  Status        : enumeration (Built, Planned) applies to (all);
  Artifact_Id   : aadlstring applies to (device, data);
end GTM_Properties;
```

## 3. Data types

```aadl
package GTM_Data
public
  with GTM_Properties;

  -- Market map
  data Company
    properties
      GTM_Properties::Source_File => ("gtm-engine/src/market-map/types.ts");
      GTM_Properties::Invariant => (
        "status in {active, pending, candidate, rejected}",
        "fields named in locked[] are never overwritten by merge",
        "role_status in {hypothesis, confirmed}");
  end Company;

  data Company_Input  -- what an agent run or manual add hands to merge; only name is required
  end Company_Input;

  data Merge_Diff     -- added, filled, changed, skipped_locked, proposed, appended, ambiguous, unchanged
  end Merge_Diff;

  data Run            -- kind in {seed, ingest, manual, discover, enrich, sync}; carries diff, recall, cost_usd
  end Run;

  data Recall_Report  -- seed_total, found, recall, missing, new_names, contaminated
  end Recall_Report;

  data Submission     -- manual add typed into the hosted map page; status in {new, merged, rejected}
    properties
      GTM_Properties::Source_File => ("gtm-engine/src/market-map/sync.ts");
  end Submission;

  data Db_Op          -- {op: set | delete, path, data}; one write to an artifact document store
  end Db_Op;

  -- Funnel
  data Funnel_Graph
    properties
      GTM_Properties::Source_File => ("gtm-engine/src/funnel/types.ts", "gtm-engine/config/funnel.demand.json");
      GTM_Properties::Invariant => (
        "levels are BFS depth from entry over advance edges, never hand-written",
        "every node reachable from entry; every segment has a path to a won node",
        "only won and lost nodes have no exits");
  end Funnel_Graph;

  data Lead           -- id, name, company, title, segment, fields
  end Lead;

  data Trace_Event    -- lead, at, from, to, via {edge | objection | import | set}, message, reply, note
  end Trace_Event;

  data Reply_Text     -- a prospect's words, pasted by the founder
  end Reply_Text;

  -- Outreach Studio
  data Workspace_State
    properties
      GTM_Properties::Source_File => ("apps/outreach/src/model.ts", "apps/outreach/src/tracker-model.ts");
  end Workspace_State;

  data Prospect       -- status in {new, replied, meeting, paused, opted_out}; revision increments on edit
  end Prospect;

  data Approval       -- prospectId, revision, reviewer, mode, channels
  end Approval;

  data Receipt        -- status in {running, simulated, accepted, submitted, handoff, uncertain, canceled}; immutable snapshot
  end Receipt;

  data Sheet_Row
    properties
      GTM_Properties::Source_File => ("apps/outreach/src/sheet-sync.ts");
  end Sheet_Row;

  -- Demand outreach build
  data Demand_Company -- name, category, own_models, workload, people[]
    properties
      GTM_Properties::Source_File => ("output-demand/build.py");
  end Demand_Company;

  data Tracker_Row    -- one row of the page's done, sent or stage collection
  end Tracker_Row;
end GTM_Data;
```

## 4. gtm-engine

Bun 1.3, `bun:sqlite`. CLI (`src/cli.ts`, `src/funnel/cli.ts`) and HTTP server (`src/server.ts`) call the same modules.

```aadl
package GTM_Engine
public
  with GTM_Data, GTM_Properties;

  ---------------------------------------------------------------- stores
  data Market_Map_DB
    properties
      GTM_Properties::Storage_Path => "gtm-engine/data/market-map.sqlite";
      GTM_Properties::Gitignored => true;
      GTM_Properties::Holds_PII => true;   -- people[] per company
      GTM_Properties::Sole_Writer => "Market_Map.Merge (and editCompany)";
      GTM_Properties::Source_File => ("gtm-engine/src/market-map/store.ts");
      GTM_Properties::Invariant => (
        "tables: companies, runs, sources; each row holds the record as JSON",
        "WAL journal; merge and run bookkeeping run in one transaction");
  end Market_Map_DB;

  data Funnel_DB
    properties
      GTM_Properties::Storage_Path => "gtm-engine/data/funnel.sqlite";
      GTM_Properties::Gitignored => true;
      GTM_Properties::Holds_PII => true;
      GTM_Properties::Append_Only => true;  -- events table
      GTM_Properties::Source_File => ("gtm-engine/src/funnel/trace.ts");
      GTM_Properties::Invariant => (
        "tables: leads, events",
        "a lead's current node is the to of its last event");
  end Funnel_DB;

  data Agent_Output_Archive  -- raw agent replies, re-mergeable at no cost with `map replay`
    properties
      GTM_Properties::Storage_Path => "gtm-engine/data/agent-output/";
      GTM_Properties::Gitignored => true;
  end Agent_Output_Archive;

  data Config  -- company.json, product-marketing.md, funnel.demand.json, seeds/cobursa-2026-09-15.json
    properties
      GTM_Properties::Source_File => (
        "gtm-engine/config/company.json",
        "gtm-engine/config/product-marketing.md",
        "gtm-engine/config/funnel.demand.json",
        "gtm-engine/seeds/cobursa-2026-09-15.json");
      GTM_Properties::Invariant => ("swap these files to run the engine for another company");
  end Config;

  ---------------------------------------------------------------- market map process
  process Market_Map
    features
      cmd_add        : in event data port GTM_Data::Company_Input;   -- map add, POST /api/companies
      cmd_edit       : in event data port GTM_Data::Company_Input;   -- map edit, PATCH /api/companies/:id (locks fields)
      cmd_discover   : in event port;                                -- map discover --segment --blind, POST /api/runs
      cmd_enrich     : in event port;                                -- map enrich [--ids]
      x_post         : in data port GTM_Data::Company_Input;         -- from fxtwitter mirror
      agent_prompt   : out event data port;                          -- to Claude Code
      agent_reply    : in event data port GTM_Data::Company_Input;   -- JSON {companies[], searched[], gaps}
      submissions_in : in event data port GTM_Data::Submission;      -- map import-submissions data/pull/submissions
      export_out     : out event data port GTM_Data::Db_Op;          -- map export -> data/artifact-export/batches.json
      sub_updates    : out event data port GTM_Data::Db_Op;          -- data/submission-updates.json
      state_out      : out data port;                                -- GET /api/state
      db             : requires data access Market_Map_DB;
      archive        : requires data access Agent_Output_Archive;
      cfg            : requires data access Config;
    flows
      f_discover : flow path cmd_discover -> agent_prompt;
      f_merge    : flow path agent_reply -> export_out;
      f_subs     : flow path submissions_in -> sub_updates;
    properties
      GTM_Properties::Runtime => Bun;
      GTM_Properties::Status => Built;
  end Market_Map;

  process implementation Market_Map.impl
    subcomponents
      seed      : subprogram Seed;
      ingest_x  : subprogram Ingest_X;
      matcher   : subprogram Match;
      merge     : subprogram Merge;
      agent     : subprogram Agent_Run;
      eval      : subprogram Recall_Eval;
      sync      : subprogram Sync;
    properties
      GTM_Properties::Invariant => (
        "merge is the only way data enters the map",
        "dedupe by domain, handle, name, alias, token overlap",
        "an input matching two companies is not merged; it is listed as ambiguous",
        "agent may not move a company's segment or role; it writes a proposal",
        "one agent run at a time; a second POST /api/runs returns 409");
  end Market_Map.impl;

  subprogram Seed
    properties GTM_Properties::Source_File => ("gtm-engine/src/market-map/seed.ts");
  end Seed;
  subprogram Ingest_X
    properties GTM_Properties::Source_File => ("gtm-engine/src/market-map/ingest-x.ts");
  end Ingest_X;
  subprogram Match
    properties GTM_Properties::Source_File => ("gtm-engine/src/market-map/match.ts");
  end Match;
  subprogram Merge
    properties GTM_Properties::Source_File => ("gtm-engine/src/market-map/merge.ts");
  end Merge;
  subprogram Agent_Run
    properties
      GTM_Properties::Source_File => ("gtm-engine/src/market-map/agent.ts", "gtm-engine/.claude/skills/market-map/SKILL.md");
      GTM_Properties::Invariant => (
        "spawns: claude -p --output-format json --allowedTools WebSearch,WebFetch,Read --max-turns 60",
        "timeout 20 min",
        "segment briefs carry no company names, so blind runs stay blind");
      GTM_Properties::Cost_Per_Run => "discover ~3.46 USD, enrich ~0.75 USD (24 Sep 2026)";
  end Agent_Run;
  subprogram Recall_Eval
    properties
      GTM_Properties::Source_File => ("gtm-engine/src/market-map/eval.ts");
      GTM_Properties::Invariant => ("a run that cites the seed post or cobursa.com is marked contaminated");
  end Recall_Eval;
  subprogram Sync
    properties
      GTM_Properties::Source_File => ("gtm-engine/src/market-map/sync.ts");
      GTM_Properties::Invariant => ("runs are exported without raw log; raw agent output stays local");
  end Sync;

  ---------------------------------------------------------------- funnel process
  process Funnel
    features
      leads_in     : in event data port GTM_Data::Demand_Company;  -- funnel leads ../output-demand/demand-outreach.json
      tracker_in   : in event data port GTM_Data::Tracker_Row;     -- funnel import data/pull/demand
      reply_in     : in event data port GTM_Data::Reply_Text;      -- funnel classify / log --reply
      move_in      : in event data port GTM_Data::Trace_Event;     -- funnel log, POST /api/funnel/moves
      next_out     : out data port;                                -- funnel next: stage, message, exits, objections
      due_out      : out data port;                                -- funnel due: passed timeouts
      page_out     : out data port;                                -- funnel page: data/funnel-page.html, counts only
      view_out     : out data port;                                -- GET /api/funnel (with leads, loopback only)
      db           : requires data access Funnel_DB;
      cfg          : requires data access Config;
    flows
      f_import : flow path tracker_in -> page_out;
      f_reply  : flow path reply_in -> next_out;
    properties
      GTM_Properties::Runtime => Bun;
      GTM_Properties::Status => Built;
  end Funnel;

  process implementation Funnel.impl
    subcomponents
      graph    : subprogram Graph_Engine;
      trace    : subprogram Trace_Log;
      import   : subprogram Tracker_Import;
      view     : subprogram View_Export;
    properties
      GTM_Properties::Invariant => (
        "graph 2026-10-03: 15 nodes, 3 segments (orchestrator, audio, non_audio), 19 objections",
        "move refuses any transition that is not an edge or objection route out of the current node",
        "classify only suggests; the founder confirms before log",
        "objection status hypothesis -> observed only by the founder",
        "import is idempotent; a stage row adds an event only when it differs from the log");
  end Funnel.impl;

  subprogram Graph_Engine
    properties GTM_Properties::Source_File => ("gtm-engine/src/funnel/graph.ts");
  end Graph_Engine;
  subprogram Trace_Log
    properties GTM_Properties::Source_File => ("gtm-engine/src/funnel/trace.ts");
  end Trace_Log;
  subprogram Tracker_Import
    properties GTM_Properties::Source_File => ("gtm-engine/src/funnel/import.ts");
  end Tracker_Import;
  subprogram View_Export
    properties GTM_Properties::Source_File => ("gtm-engine/src/funnel/view.ts", "gtm-engine/web/funnel.html");
  end View_Export;

  ---------------------------------------------------------------- engine system
  system Engine
    features
      http      : in out event data port;  -- 127.0.0.1:4320: /, /funnel, /api/state, /api/companies, /api/runs, /api/funnel, /api/funnel/moves
      cli       : in event data port;
      to_claude : out event data port;
      from_claude : in event data port GTM_Data::Company_Input;
      x_in      : in data port GTM_Data::Company_Input;
      store_out : out event data port GTM_Data::Db_Op;
      store_in  : in event data port;      -- pulled submissions and tracker rows
    properties
      GTM_Properties::Bind_Address => "127.0.0.1";
      GTM_Properties::Listen_Port => 4320;
      GTM_Properties::Source_File => ("gtm-engine/src/server.ts", "gtm-engine/src/cli.ts", "gtm-engine/src/funnel/cli.ts");
  end Engine;

  system implementation Engine.impl
    subcomponents
      mm      : process Market_Map.impl;
      fn      : process Funnel.impl;
      mm_db   : data Market_Map_DB;
      fn_db   : data Funnel_DB;
      archive : data Agent_Output_Archive;
      cfg     : data Config;
    connections
      a1 : data access mm_db   -> mm.db;
      a2 : data access archive -> mm.archive;
      a3 : data access cfg     -> mm.cfg;
      a4 : data access fn_db   -> fn.db;
      a5 : data access cfg     -> fn.cfg;
      c1 : port mm.agent_prompt -> to_claude;
      c2 : port from_claude -> mm.agent_reply;
      c3 : port x_in -> mm.x_post;
      c4 : port mm.export_out -> store_out;
      c5 : port mm.sub_updates -> store_out;
      c6 : port store_in -> mm.submissions_in;
      c7 : port store_in -> fn.tracker_in;
  end Engine.impl;
end GTM_Engine;
```

## 5. Outreach Studio

Bun + React 19 client, `nodemailer`, `playwright`. Single operator, local.

```aadl
package Outreach_Studio
public
  with GTM_Data, GTM_Properties;

  data Workspace_DB
    properties
      GTM_Properties::Storage_Path => "apps/outreach/.data/workspace.sqlite";
      GTM_Properties::Gitignored => true;
      GTM_Properties::Holds_PII => true;
      GTM_Properties::Source_File => ("apps/outreach/src/store.ts");
      GTM_Properties::Invariant => (
        "one row (id = 1) holds the whole workspace State as JSON",
        "state.version increments on every change");
  end Workspace_DB;

  data Source_Folder  -- OUTREACH_SOURCE_DIR: source.json names providers, sheet, sheetLatest, curated, emailResearch, samples
    properties
      GTM_Properties::Storage_Path => "apps/outreach/data/";
      GTM_Properties::Holds_PII => true;   -- in a real instance; tests use tests/fixtures (fictional)
      GTM_Properties::Source_File => ("apps/outreach/src/source-data.ts", "apps/outreach/src/tracker-source.ts", "apps/outreach/tests/fixtures/source.json");
      GTM_Properties::Invariant => (
        "aliases, prior-contact ids, curated drafts and sheet URL come from source.json, not code",
        "tests always load tests/fixtures, never a workspace's real data");
  end Source_Folder;

  process Studio_Server
    features
      http        : in out event data port;  -- GET /api/state /api/export /api/tracker.csv; POST /api/approve /api/prospect /api/add /api/campaign /api/compose /api/research /api/import /api/sender /api/tracker-* /api/reset-test
      sheet_in    : in event data port GTM_Data::Sheet_Row;
      research_q  : out event data port GTM_Data::Prospect;     -- domain + campaign offer only
      research_a  : in event data port GTM_Data::Prospect;
      smtp_out    : out event data port GTM_Data::Receipt;
      form_out    : out event data port GTM_Data::Receipt;
      handoff_out : out event data port GTM_Data::Receipt;      -- copy text + open profile; no send
      db          : requires data access Workspace_DB;
      src         : requires data access Source_Folder;
    flows
      f_send : flow path http -> smtp_out;
    properties
      GTM_Properties::Runtime => Bun;
      GTM_Properties::Bind_Address => "127.0.0.1";
      GTM_Properties::Listen_Port => 4310;  -- OUTREACH_PORT
      GTM_Properties::Status => Built;
      GTM_Properties::Source_File => ("apps/outreach/src/server.ts");
      GTM_Properties::Invariant => (
        "test mode is the default; live needs OUTREACH_ENABLE_LIVE=true and a selected Live mode",
        "cross-origin writes and unknown Host headers are rejected",
        "credentials stay server-side; never returned to the UI");
  end Studio_Server;

  process implementation Studio_Server.impl
    subcomponents
      model     : subprogram Compose_And_Blockers;
      executor  : subprogram Approve_And_Run;
      adapters  : subprogram Transports;
      research  : subprogram Research;
      tracker   : subprogram Tracker_Actions;
      sheet     : subprogram Sheet_Sync;
      senders   : subprogram Sender_Switch;
    properties
      GTM_Properties::Invariant => (
        "an approval executes one exact snapshot: prospect revision + workspace version",
        "actions are reserved in a SQLite transaction before dispatch; duplicates are blocked",
        "a timeout or crash leaves status uncertain; no automatic retry",
        "companies with prior activity are blocked from fresh live outreach",
        "opt-out is sticky",
        "sheet values merge only where the local field is unchanged; conflicts wait for Keep local / Use sheet",
        "SMTP accepted is not delivered; handoff is not sent");
  end Studio_Server.impl;

  subprogram Compose_And_Blockers
    properties GTM_Properties::Source_File => ("apps/outreach/src/model.ts", "apps/outreach/src/application-copy.ts");
  end Compose_And_Blockers;
  subprogram Approve_And_Run
    properties GTM_Properties::Source_File => ("apps/outreach/src/executor.ts");
  end Approve_And_Run;
  subprogram Transports  -- test inbox, nodemailer SMTP, Playwright form fill, LinkedIn handoff
    properties GTM_Properties::Source_File => ("apps/outreach/src/adapters.ts", "apps/outreach/forms.example.json");
  end Transports;
  subprogram Research
    properties GTM_Properties::Source_File => ("apps/outreach/src/research.ts");
  end Research;
  subprogram Tracker_Actions
    properties GTM_Properties::Source_File => ("apps/outreach/src/tracker-actions.ts", "apps/outreach/src/tracker-model.ts");
  end Tracker_Actions;
  subprogram Sheet_Sync
    properties GTM_Properties::Source_File => ("apps/outreach/src/sheet-sync.ts", "apps/outreach/scripts/sync-sheet.ts", "apps/outreach/scripts/read-sheet.py");
  end Sheet_Sync;
  subprogram Sender_Switch
    properties GTM_Properties::Source_File => ("apps/outreach/src/senders.ts");
  end Sender_Switch;

  abstract Studio_Client  -- React UI; registers read-only WebMCP review tools when the browser offers modelContext
    properties
      GTM_Properties::Runtime => Browser;
      GTM_Properties::Source_File => ("apps/outreach/src/client.tsx", "apps/outreach/src/tracker.tsx", "apps/outreach/src/webmcp.ts");
  end Studio_Client;

  system Studio
    features
      ui        : in out event data port;
      sheet_in  : in event data port GTM_Data::Sheet_Row;
      openai    : in out event data port;
      smtp      : out event data port GTM_Data::Receipt;
      forms     : out event data port GTM_Data::Receipt;
      linkedin  : out event data port GTM_Data::Receipt;
  end Studio;

  system implementation Studio.impl
    subcomponents
      srv    : process Studio_Server.impl;
      client : abstract Studio_Client;
      db     : data Workspace_DB;
      snap   : data Source_Folder;
    connections
      a1 : data access db   -> srv.db;
      a2 : data access snap -> srv.src;
      c1 : port ui <-> srv.http;
      c2 : port sheet_in -> srv.sheet_in;
      c3 : port srv.research_q -> openai;
      c4 : port openai -> srv.research_a;
      c5 : port srv.smtp_out -> smtp;
      c6 : port srv.form_out -> forms;
      c7 : port srv.handoff_out -> linkedin;
  end Studio.impl;
end Outreach_Studio;
```

## 6. Demand outreach build

```aadl
package Demand_Build
public
  with GTM_Data, GTM_Properties;

  process Build_Py
    features
      research_in : in data port GTM_Data::Demand_Company;  -- data-01.json (rounds 1 and 2), data-02-round2.json
      json_out    : out data port GTM_Data::Demand_Company; -- demand-outreach.json
      csv_out     : out data port;                          -- demand-crm.csv
      md_out      : out data port;                          -- 01..06 markdown per segment and stage
    flows
      f_build : flow path research_in -> json_out;
    properties
      GTM_Properties::Runtime => Python;
      GTM_Properties::Source_File => ("output-demand/build.py");
      GTM_Properties::Invariant => (
        "per person: InMail + subject, connection note <= 300 chars, Stage 1 founder message (edtech pilot), v2 follow-up",
        "message branches on own_models (own, partial, orchestrator) and category",
        "JSON is spliced by hand into the page's <script id=data> block, then republished");
      GTM_Properties::Status => Built;
  end Build_Py;
end Demand_Build;
```

## 7. External components

```aadl
package GTM_External
public
  with GTM_Data, GTM_Properties;

  abstract Founder  -- runs CLI, approves actions, sends LinkedIn messages by hand, pastes replies, confirms objections
    features
      cli      : out event data port;
      browser  : in out event data port;
      session  : in out event data port;   -- Claude Code session that moves data to and from artifact stores
      linkedin : out event data port;
  end Founder;

  device Claude_Code_Headless
    features
      prompt : in event data port;
      reply  : out event data port GTM_Data::Company_Input;
    properties
      GTM_Properties::Runtime => Claude_Code;
      GTM_Properties::Invariant => ("tools limited to WebSearch, WebFetch, Read");
  end Claude_Code_Headless;

  device Fxtwitter_Mirror  -- https://api.fxtwitter.com/{handle}/status/{id}; no API key; no replies returned
    features
      post : out data port GTM_Data::Company_Input;
  end Fxtwitter_Mirror;

  device Map_Artifact_Store
    features
      engine_writes : in event data port GTM_Data::Db_Op;     -- companies, runs, meta/map
      viewer_writes : out event data port GTM_Data::Submission;
    properties
      GTM_Properties::Runtime => Hosted;
      GTM_Properties::Invariant => ("viewers write submissions only; writes to companies are refused");
  end Map_Artifact_Store;

  device Demand_Artifact_Store
    features
      page_data   : in data port GTM_Data::Demand_Company;
      tracker_out : out event data port GTM_Data::Tracker_Row;  -- done, sent, stage
    properties
      GTM_Properties::Runtime => Hosted;
  end Demand_Artifact_Store;

  device Google_Sheet  -- read as XLSX export; nothing is written back
    features
      rows : out event data port GTM_Data::Sheet_Row;
  end Google_Sheet;

  device OpenAI_Responses  -- optional; OPENAI_API_KEY + OUTREACH_RESEARCH_MODEL
    features
      io : in out event data port;
  end OpenAI_Responses;

  device SMTP_Mailbox  -- one mailbox per server; OUTREACH_SMTP_FROM must match campaign sender
    features
      mail : in event data port GTM_Data::Receipt;
  end SMTP_Mailbox;

  device Partner_Forms  -- Playwright, only for developer-mapped forms in OUTREACH_FORMS_FILE; none bundled
    features
      submit : in event data port GTM_Data::Receipt;
  end Partner_Forms;

  device LinkedIn  -- no automation; operator uses LinkedIn's own composer
    features
      compose : in event data port;
  end LinkedIn;

  device Deploy_Report_MCP  -- https://registry.deploy.report/mcp; used by the outreach skill for the neocloud run
  end Deploy_Report_MCP;

  abstract Outreach_Skill  -- Claude Code skill: company name -> contacts, LinkedIn search strings, messages (markdown)
    properties
      GTM_Properties::Source_File => (".claude/skills/outreach/SKILL.md", "skills/review-first-outreach/SKILL.md");
  end Outreach_Skill;
end GTM_External;
```

## 8. Top-level system and end-to-end flows

```aadl
package GTM_App
public
  with GTM_Engine, Outreach_Studio, Demand_Build, GTM_External, GTM_Properties;

  system GTM_Application
  end GTM_Application;

  system implementation GTM_Application.impl
    subcomponents
      founder   : abstract GTM_External::Founder;
      engine    : system GTM_Engine::Engine.impl;
      studio    : system Outreach_Studio::Studio.impl;
      build     : process Demand_Build::Build_Py;
      claude    : device GTM_External::Claude_Code_Headless;
      fx        : device GTM_External::Fxtwitter_Mirror;
      map_page  : device GTM_External::Map_Artifact_Store;
      dem_page  : device GTM_External::Demand_Artifact_Store;
      sheet     : device GTM_External::Google_Sheet;
      openai    : device GTM_External::OpenAI_Responses;
      smtp      : device GTM_External::SMTP_Mailbox;
      forms     : device GTM_External::Partner_Forms;
      li        : device GTM_External::LinkedIn;
      deploy    : device GTM_External::Deploy_Report_MCP;
      skill     : abstract GTM_External::Outreach_Skill;
    connections
      -- market map
      e1 : port founder.cli -> engine.cli;
      e2 : port engine.to_claude -> claude.prompt;
      e3 : port claude.reply -> engine.from_claude;
      e4 : port fx.post -> engine.x_in;
      e5 : port engine.store_out -> map_page.engine_writes;      -- via founder's Claude Code session (ArtifactData batch)
      e6 : port map_page.viewer_writes -> engine.store_in;       -- via ArtifactData list, out_dir data/pull
      -- demand outreach
      d1 : port build.json_out -> dem_page.page_data;            -- hand splice + republish
      d2 : port dem_page.tracker_out -> engine.store_in;         -- via ArtifactData list, out_dir data/pull/demand
      d3 : port founder.linkedin -> li.compose;                  -- manual send
      -- studio
      s1 : port founder.browser <-> studio.ui;
      s2 : port sheet.rows -> studio.sheet_in;
      s3 : port studio.openai <-> openai.io;
      s4 : port studio.smtp -> smtp.mail;
      s5 : port studio.forms -> forms.submit;
      s6 : port studio.linkedin -> li.compose;                   -- handoff: opens profile, operator sends
    properties
      GTM_Properties::Invariant => (
        "no runtime connection between engine and studio",
        "every write to a claude.ai artifact store passes through the founder's Claude Code session",
        "no component sends a LinkedIn message",
        "real people live only in gitignored data/ and .data/; tests use tests/fixtures");
  end GTM_Application.impl;
end GTM_App;
```

End-to-end flows. Kept as a table: the system types above do not forward per-process flow specs, so AADL `end to end flow` declarations would not resolve.

| Flow | Path (connection ids from `GTM_Application.impl`) | Trigger | Cost |
|---|---|---|---|
| F1 discovery | `founder.cli` -e1-> `engine.mm.f_discover` -e2-> `claude` -e3-> `engine.mm.f_merge` -e5-> `map_page` | `map discover --segment X [--blind]` or `POST /api/runs` | one paid `claude -p` run |
| F2 submissions | `map_page.viewer_writes` -e6-> `engine.mm.f_subs` -e5-> `map_page` | founder's Claude Code session pulls `submissions` | free unless `enrich` follows |
| F3 demand | `build.f_build` -d1-> `dem_page` -d3 (founder sends on LinkedIn)- `dem_page.tracker_out` -d2-> `engine.fn.f_import` | `python3 build.py`, splice, republish; `funnel import data/pull/demand` | free |
| F4 provider outreach | `sheet` -s2-> `studio.srv` (review, approve) -s4/s5/s6-> `smtp` / `forms` / `li` | `sync-sheet.ts`, then one approval per action set | SMTP and OpenAI usage only |

## 9. Planned parts (not built)

```aadl
package GTM_Planned
public
  with GTM_Properties;

  abstract Twenty_CRM_Adapter        properties GTM_Properties::Status => Planned; end Twenty_CRM_Adapter;
  abstract Reply_Mining              properties GTM_Properties::Status => Planned; end Reply_Mining;        -- X replies; fxtwitter returns none
  abstract Reddit_HN_Ingest          properties GTM_Properties::Status => Planned; end Reddit_HN_Ingest;    -- read-only Reddit MCP
  abstract Supply_Funnel_Graph       properties GTM_Properties::Status => Planned; end Supply_Funnel_Graph; -- config/funnel.supply.json
  abstract LinkedIn_Export_Importer  properties GTM_Properties::Status => Planned; end LinkedIn_Export_Importer; -- messages.csv, not computer use
  abstract Benchmark_Card_Self_Serve properties GTM_Properties::Status => Planned; end Benchmark_Card_Self_Serve; -- document and retrieval leads
  abstract Engine_Studio_Bridge      properties GTM_Properties::Status => Planned; end Engine_Studio_Bridge; -- plan: extend Studio, Twenty as system of record
end GTM_Planned;
```

## 10. Invariants and where they are enforced

| Invariant | Component | Code |
|---|---|---|
| Only the engine writes map `companies`, `runs`, `meta`; the page writes `submissions` | `Map_Artifact_Store`, `Sync` | `gtm-engine/src/market-map/sync.ts` |
| Merge never overwrites a `locked` field; agent segment and role changes become `proposed` | `Merge` | `gtm-engine/src/market-map/merge.ts` |
| An input matching two companies is not merged | `Match`, `Merge` | `gtm-engine/src/market-map/match.ts` |
| One agent run at a time (HTTP 409) | `Engine` | `gtm-engine/src/server.ts` |
| Blind runs see no seed names; seed citations mark the run contaminated | `Agent_Run`, `Recall_Eval` | `gtm-engine/src/market-map/agent.ts`, `eval.ts` |
| Trace is append-only; `move` refuses non-edges | `Trace_Log` | `gtm-engine/src/funnel/trace.ts` |
| Graph validates reachability and a path to a win per segment | `Graph_Engine` | `gtm-engine/src/funnel/graph.ts` |
| Studio test mode by default, loopback only, Host and Origin checked | `Studio_Server` | `apps/outreach/src/server.ts` |
| Approval bound to prospect revision and workspace version; reserved before dispatch | `Approve_And_Run` | `apps/outreach/src/executor.ts` |
| Prior-activity companies blocked from fresh live outreach; opt-out sticky | `Compose_And_Blockers`, `Tracker_Actions` | `apps/outreach/src/model.ts`, `tracker-model.ts` |
| No LinkedIn automation | `Transports`, `LinkedIn` | `apps/outreach/src/adapters.ts` |

## 11. Gaps the model shows

1. Two people stores with no shared key. Today they hold different populations: Studio's `workspace.sqlite` has the 106 supply-side providers; `funnel.sqlite` has the 117 demand-side companies. Overlap starts once Studio's customer-campaign path holds demand leads or `Engine_Studio_Bridge` lands. Pick the system of record (plan says Twenty) before then.
2. Artifact sync is manual. Connections `e5`, `e6`, `d1`, `d2` each depend on the founder running a Claude Code session. No schedule exists.
3. `build.py` output reaches the page by a hand splice. A missed splice leaves the page and `demand-outreach.json` out of step, and `funnel leads` reads the JSON.
4. Reply capture is manual on both sides (`Reply_Text` is pasted). The funnel's objection counts are only as complete as that habit.
