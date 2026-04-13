# Kotlin Agents for Claude Code

Specialized AI agents for Kotlin/Spring Boot backend and Compose Multiplatform development.

## Installation

### Option 1: Install from GitHub (Recommended)

```bash
# Add the marketplace
/plugin marketplace add https://github.com/AlexGladkov/claude-code-agents

# Install the plugin
/plugin install kotlin-agents
```

### Option 2: Install from Local Clone

```bash
# Clone the repository
git clone https://github.com/AlexGladkov/claude-code-agents.git

# Add the local marketplace
/plugin marketplace add ./claude-code-agents

# Install the plugin
/plugin install kotlin-agents
```

## Available Agents

| Agent | Description |
|-------|-------------|
| **init-kotlin** | Repository bootstrap for clean Kotlin Spring Boot or full-stack (Spring + Compose) projects |
| **builder-spring-feature** | Feature generation for Spring Boot with strict architecture (feature-slice, layering, dependency validation) |
| **builder-compose-feature** | Feature generation for Compose Multiplatform with Screen/View/Component separation and MVVM |
| **test-spring** | High-quality test automation following SDET/AQA practices, AAA pattern, Testcontainers integration |
| **kotlin-diagnostics** | Bug detection and diagnosis for Kotlin/Compose/Android/Spring with automatic runtime analysis |
| **refactor-spring** | Architectural refactoring of Spring applications enforcing SOLID, layering, file structure |
| **refactor-mobile** | Architectural refactoring of Android code (Clean Architecture, Compose, Decompose, Kodein) |
| **security-kotlin** | OWASP security auditing for Spring Boot with comprehensive vulnerability scanning |
| **devops-orchestrator** | Docker environment setup, multi-env configs, CI/CD pipelines, automated deployments |
| **system-analytics** | Technical specification generation from user requests, saved as structured Markdown |

## Development Workflow

These agents cover the complete development lifecycle:

```
1. init-kotlin           --> scaffold new projects
        |
        v
2. builder-spring        --> generate backend features
   builder-compose       --> generate mobile features
        |
        v
3. test-spring           --> write comprehensive tests
        |
        v
4. diagnostics-kotlin    --> find and fix bugs
        |
        v
5. refactor-spring       --> clean up backend architecture
   refactor-mobile       --> clean up mobile architecture
        |
        v
6. security-kotlin       --> OWASP audit
        |
        v
7. devops-orchestrator   --> containerization and CI/CD
```

## Architecture Patterns Enforced

### Spring Boot (Backend)

- Feature-slice organization: `feature/<name>/api/service/persistence/domain/`
- Layered architecture: Controller -> Service -> Repository (no shortcuts)
- One type per file, max 1000 lines per file, max 100 lines per method

### Compose Multiplatform (Frontend)

- Feature-slice: `feature/<name>/screen/view/component/domain/data/di/`
- MVVM with Decompose: Component holds state, View is pure UI
- Use cases always return `Result<T>`
- No `remember()` in Views, max 600 lines ideal per file

### Common Rules

- Unidirectional data flow, no cyclic dependencies
- SOLID principles strictly enforced
- Tests follow AAA pattern with Testcontainers for external deps

## Contributing

To suggest a new subagent, open a Pull Request with a markdown file following the existing agent patterns in `agents/`.

## License

MIT
