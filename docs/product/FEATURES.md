# ParallelX features

Parallax provides an execution Studio, guided lessons, coding challenges, and local workspace settings. Learn and Challenges are discoverable from the app navigation.

```mermaid
flowchart TD
    App["Parallax app navigation"]
    App --> Studio
    App --> Learn
    App --> Challenges
    App --> Settings
    Learn -->|Runnable example| Studio
    Challenges -->|Inspect a solution| Studio
    Studio --> Visualize
    Studio --> Inspect
    Studio --> Analyze
    Studio --> Console
    Studio --> Sessions
    Visualize --> Canvas["Structure Canvas"]
    Visualize --> Memory["Stack & Heap"]
    Sessions --> Backup["Portable JSON backup"]
    Settings --> Backup
```

## Studio

The left pane contains the CodeMirror editor, language and template selectors, and breakpoint controls. The execution workspace uses a shared playback timeline. You can step in either direction, jump between breakpoints, scrub to a frame, and adjust playback speed.

| Workspace | What it shows |
| --- | --- |
| **Visualize → Structure Canvas** | Arrays, lists, maps, graphs, trees, and other data structures when recognized in the trace. Array cells show their indices and highlight recorded reads, writes, and swaps. |
| **Visualize → Stack & Heap** | The selected step's call frames and heap objects. References can link to the corresponding object. The address model depends on the runtime. |
| **Inspect** | Variables, call stack, memory, patterns, loops, and conditions, plus runtime-specific views when available. |
| **Analyze** | Tools for comparing traces, measuring step growth, testing edge cases, and predicting execution behavior. |
| **Console** | Program output and trace errors. |
| **Sessions** | Saved code and controls for exporting or importing local work. |

### Runtime-specific inspection

| Runtime | Additional Inspect views |
| --- | --- |
| C | Pointers, Structs, Lifecycle |
| C++ | Pointers & Ownership, Objects & Structs, STL & Iterators, Lifecycle |
| Java | Objects & References, Collections & Iterators, Exceptions |
| C# | Objects & Value Types, Collections & Iterators, Lifecycle |

These views show the information recorded by the selected runtime. In Browser Mode, C and C++ use 32-bit WebAssembly offsets. Java and C# traces use symbolic object identities. See the [memory model](../architecture/MEMORY_MODEL.md) and [language compatibility matrix](../reference/LANGUAGE_COMPATIBILITY.md).

## Learn

Lessons cover complexity, arrays and strings, two pointers and sliding windows, linked lists, trees and graphs, stacks and queues, and dynamic programming. Open a runnable example in Studio to compare the explanation with what the trace records. Progress is saved in the browser.

## Challenges

Choose a problem, write a solution, and run the public cases. A configured evaluation server can run additional server-side cases and return sanitized results. Browser-only deployments can run the public cases locally. Inspect your solution in Studio to follow its behavior step by step.

## Settings and portability

Set editor preferences, default language, replay speed, and an optional Native Execution Server URL. Use JSON backups to move preferences, saved sessions, and progress between browsers. See the [environment configuration](../deployment/ENVIRONMENT_CONFIGURATION.md) for deployment settings.
