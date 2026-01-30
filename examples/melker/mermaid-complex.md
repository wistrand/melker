# Interactive Workflow Demo

This document demonstrates mermaid diagrams with custom melker components embedded in markdown.

## User Registration Flow

The following diagram shows a user registration workflow with interactive form elements:

```mermaid
flowchart LR
    Start --> Input --> Validate --> Submit

%%melker:Start
%%<button label="Begin Registration" />
%%end

%%melker:Input
%%<container style="flex-direction: column; gap: 1">
%%  <input id="reg-email" placeholder="Email address" style="width: 20" />
%%  <input id="reg-pass" placeholder="Password" style="width: 20" />
%%</container>
%%end

%%melker:Validate
%%<container style="flex-direction: column">
%%  <checkbox title="I agree to terms" />
%%  <checkbox title="Subscribe to newsletter" />
%%</container>
%%end

%%melker:Submit
%%<button label="Create Account" />
%%end
```

## Data Processing Pipeline

Here's a simple data flow:

```mermaid
flowchart LR
    A --> B --> C

%%melker:A
%%<text style="font-weight: bold">Source</text>
%%end

%%melker:B
%%<progress value="75" max="100" style="width: 15" />
%%end

%%melker:C
%%<text style="color: green">Complete</text>
%%end
```

## Notes

- Custom components are defined using `%%melker:ID` blocks
- Each node can contain any valid melker element
- Components render as ASCII representations: `[ Button ]`, `[input]`, `[ ] checkbox`
- For full interactive components with click handlers, use `<graph>` directly in a .melker file
