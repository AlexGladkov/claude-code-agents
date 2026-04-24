# Claude Code Agents

Specialized AI agents for Claude Code — organized by domain. Multi-plugin marketplace.

## Repository Structure

```
claude-code-agents/
├── .claude-plugin/
│   └── marketplace.json          # Marketplace catalog (2 plugins)
├── plugins/
│   ├── ai-sdlc/                  # Plugin: AI-powered SDLC agents
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   └── agents/
│   └── ai-university/            # Plugin: AI University
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── skills/study/SKILL.md # /ai-university:study skill
│       ├── agents/education/
│       ├── config/
│       └── scripts/
├── agents/                       # Original agent files (for direct use)
│   ├── coding/kotlin/
│   └── education/
├── config/
│   └── university.yaml
├── scripts/
│   └── generate-harness.sh
└── README.md
```

## Installation

### Option 1: Install from GitHub (Recommended)

```bash
# Add the marketplace
/plugin marketplace add https://github.com/AlexGladkov/claude-code-agents

# Install individual plugins
/plugin install ai-sdlc
/plugin install ai-university
```

### Option 2: Install from Local Clone

```bash
# Clone the repository
git clone https://github.com/AlexGladkov/claude-code-agents.git

# Add the local marketplace
/plugin marketplace add ./claude-code-agents

# Install individual plugins
/plugin install ai-sdlc
/plugin install ai-university
```

### Available Plugins

| Plugin | Description |
|--------|-------------|
| **ai-sdlc** | AI-powered SDLC agents for Kotlin/Spring Boot + Compose Multiplatform |
| **ai-university** | AI University — teaching agents for medicine, AI/ML |

## Available Agents

### Coding / Kotlin

Located in `agents/coding/kotlin/`

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
| **kotlin-multiplatform-developer** | Full KMP feature slice generator (domain + data + presentation) with feature-sliced architecture |

### Education / University

The education agents are organized as a virtual university with a 4-level hierarchy:

```
University → Faculty → Department → Discipline (agent)
```

The university structure is defined in `config/university.yaml` (source-of-truth).

**Quick start:**

```bash
# Generate instruction files for your AI tool
./scripts/generate-harness.sh

# Generate and install (e.g., for Claude Code)
./scripts/generate-harness.sh --install --only claude
```

Supported AI tools: Claude Code, Cursor, GitHub Copilot, Windsurf, Codex/OpenCode.

**Current structure:**

| Faculty | Department | Disciplines | Hours |
|---------|-----------|-------------|-------|
| Medical (medicine) | Biology | Anatomy, Physiology, Neurobiology | 360 |
| AI/ML (ai-ml) | AI SDLC | Prompting, MCP, RAG, Local AI, AI Security, CV, AI Agents, MLOps | 560 |
| AI/ML (ai-ml) | ML Foundations | Classical ML, Deep Learning, Transformers, Fuzzy Logic, Optimization, Generative Models, RL, RNN/TimeSeries, Graph NN | 700 |
| Robotics (robotics) | Robot Fundamentals | Kinematics & Dynamics, Sensors & Actuators, Control Systems, Electronics & MCU, Robot Math | 360 |
| Robotics (robotics) | Applied Robotics | ROS 2, Robot Vision, Motion Planning, SLAM, Simulation & Digital Twins | 360 |

**Key agents:**

| Agent | Description |
|-------|-------------|
| **rector** | University rector — top-level orchestrator, study plans, cross-faculty programs, progress aggregation |

**Medical / Biology:**

| Agent | Description |
|-------|-------------|
| **department-head** | Department head — learning orchestrator, prerequisites, interdisciplinary checks |
| **anatomy-teacher** | Human anatomy — systemic, clinical, topographic |
| **physiology-teacher** | Human physiology — all organ systems |
| **neurobiology-teacher** | Neurobiology — cellular and systems |

**AI/ML / AI SDLC:**

| Agent | Description |
|-------|-------------|
| **ai-sdlc-department-head** | Department head — AI SDLC learning orchestrator |
| **prompting-teacher** | Prompt engineering, state & context management |
| **mcp-teacher** | Model Context Protocol — servers, tools, transports |
| **rag-teacher** | RAG & Embeddings — retrieval, vector DB, chunking |
| **local-ai-teacher** | Local AI — Ollama, llama.cpp, vLLM, quantization |
| **ai-security-teacher** | AI Security — OWASP LLM Top 10, prompt injection, red teaming |
| **cv-teacher** | Computer Vision — CNN, detection, segmentation, VLM |
| **ai-agents-teacher** | AI Agents — tool use, ReAct, multi-agent, memory |
| **mlops-teacher** | MLOps — serving, monitoring, pipelines, CI/CD |

**AI/ML / ML Foundations:**

| Agent | Description |
|-------|-------------|
| **ml-foundations-department-head** | Department head — ML Foundations learning orchestrator |
| **classical-ml-teacher** | Classical ML — SVM, trees, ensembles, clustering, feature engineering |
| **deep-learning-teacher** | Deep Learning — backprop, CNN, optimizers, transfer learning |
| **transformers-teacher** | Encoder/Decoder & Transformers — attention, BERT/GPT/T5, tokenization |
| **fuzzy-logic-teacher** | Fuzzy Logic — fuzzy sets, Mamdani/Sugeno, ANFIS, neuro-fuzzy |
| **optimization-teacher** | Optimization & Learning Theory — convex/non-convex, PAC-learning, VC-dimension |
| **generative-models-teacher** | Generative Models — VAE, GAN, Diffusion, Flow-based |
| **reinforcement-learning-teacher** | Reinforcement Learning — MDP, DQN, PPO, RLHF, multi-agent |
| **rnn-timeseries-teacher** | RNN & Time Series — LSTM, GRU, TFT, forecasting, anomaly detection |
| **graph-nn-teacher** | Graph Neural Networks — GCN, GAT, knowledge graphs, molecular ML |

**Robotics / Fundamentals:**

| Agent | Description |
|-------|-------------|
| **robot-fundamentals-department-head** | Department head — robotics fundamentals orchestrator |
| **kinematics-dynamics-teacher** | Kinematics & dynamics — DH, Jacobians, mobile robots |
| **sensors-actuators-teacher** | Sensors & actuators — LiDAR, IMU, motors, sensor fusion |
| **control-systems-teacher** | Control systems — PID, LQR, adaptive, robust, real-time |
| **electronics-mcu-teacher** | Electronics & MCU — STM32, ESP32, protocols, PCB, embedded Linux |
| **robot-math-teacher** | Math for robotics — SO(3)/SE(3), quaternions, Bayesian, optimization |

**Robotics / Applied:**

| Agent | Description |
|-------|-------------|
| **applied-robotics-department-head** | Department head — applied robotics orchestrator |
| **ros2-teacher** | ROS 2 — DDS, Nav2, MoveIt 2, tf2, lifecycle |
| **robot-vision-teacher** | Robot vision — stereo, VO, 3D reconstruction, segmentation |
| **motion-planning-teacher** | Motion planning — RRT, A*, MoveIt, behavior trees, multi-robot |
| **slam-teacher** | SLAM — LiDAR/visual/multi-sensor SLAM, graph optimization |
| **simulation-teacher** | Simulation — Gazebo, Isaac Sim, MuJoCo, sim-to-real, digital twins |

## Development Workflow (Kotlin)

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

To suggest a new subagent, open a Pull Request with a markdown file in the appropriate category folder under `agents/`.

## License

MIT
