# Hostmachine Agent

## Overview

This repository contains the **Hostmachine Node Agent**, which is the "muscle" of the Hostmachine platform. This agent runs on each dedicated game server (Node) and is responsible for executing commands from the central Controller, orchestrating Docker containers for game servers, and reporting node health and security status.

It's designed for autonomous operation, enabling self-updates and self-healing.

## Key Technologies

-   **Runtime:** [Node.js](https://nodejs.org/) (TypeScript)
-   **Docker API:** [Dockerode](https://github.com/apocas/dockerode)
-   **System Info:** [Systeminformation](https://systeminformation.io/)
-   **Network:** Secure Mesh VPN (e.g., [Netmaker](https://netmaker.io/)) integration.
-   **Validation:** [Zod](https://zod.dev/)
-   **Logging:** [Winston](https://github.com/winstonjs/winston)

## Features

-   **Node Enrollment:** Securely registers with the Hostmachine Controller, obtaining an API key.
-   **Docker Orchestration:** Receives commands (Start, Stop, Create Server) from the Controller and executes them via the local Docker daemon.
-   **System Monitoring:** Periodically collects CPU, RAM, and Disk usage, reporting it back to the Controller.
-   **Self-Healing:** Monitors Docker and VPN service status and attempts recovery.
-   **Auto-Updates:** Automatically pulls the latest code from GitHub, rebuilds, and restarts itself.
-   **Security Scanning:** (Planned) Integrates with tools like Trivy to scan host OS and container images for vulnerabilities.
-   **Server Migration:** Facilitates data transfer using ZFS send/recv for minimal-downtime server moves.

## Local Development Setup

### Prerequisites

-   Node.js (v20 LTS recommended)
-   npm
-   Git
-   **Docker Desktop (for Windows/macOS) or Docker Engine (for Linux)**: Running locally to simulate a node environment.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Mekwell/hostmachine-agent.git
    cd hostmachine-agent
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Environment Variables:** Create a `.env` file in the project root:
    ```env
    CONTROLLER_URL=http://localhost:3000 # Or your Controller's VPN IP
    ENROLLMENT_TOKEN=change_me_to_something_secure_random_token_for_agent_enrollment
    LOG_LEVEL=debug
    # API_KEY will be saved to credentials.json after successful enrollment
    ```
    **IMPORTANT:** Ensure `ENROLLMENT_TOKEN` matches the `ENROLLMENT_SECRET` in your Controller's `.env`.

### Running the Application

To run the agent in development mode (it will try to enroll with a Controller running at `http://localhost:3000`):

```bash
npm run dev
```

## Deployment

Deployment to an Ubuntu 24.04 server is automated using the `deploy.sh` script located in this repository.

To deploy:

1.  SSH into your fresh Ubuntu server.
2.  Clone this repository to `/opt/hostmachine-agent`.
3.  Run the `deploy.sh` script with your specific tokens:
    ```bash
    cd /opt/hostmachine-agent
    sudo ./deploy.sh --token <YOUR_ENROLLMENT_TOKEN> --vpn-key <YOUR_NETMAKER_KEY> --controller <YOUR_CONTROLLER_VPN_IP>
    ```
    This script will install Docker, ZFS, Node.js, Netmaker client, configure firewalls, and set up the agent as a `systemd` service.

### Auto-Updates

This project is configured for automatic updates. A cron job will be set up by `deploy.sh` to regularly fetch changes from the `main` branch, rebuild, and restart the agent service if updates are available. The update logic is handled by `scripts/update.sh`.

## Full Documentation

For a comprehensive understanding of the Hostmachine project architecture, security strategy, operational procedures, and more, please refer to the dedicated documentation repository:

[Mekwell/hostmachine-docs](https://github.com/Mekwell/hostmachine-docs)

---

## License

[MIT licensed](LICENSE)