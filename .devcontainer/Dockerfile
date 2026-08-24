FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    python3-pip \
    python3-venv \
    python3-full \
    python3-yaml \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI (https://github.com/cli/cli)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Create and activate a Python virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

USER node

# Install Node package managers
RUN npm install -g yarn \
    && npm install -g hardhat bun \
    && curl -fsSL https://bun.sh/install | bash

# Set up custom prompt
RUN echo 'alias nh="npx hardhat"' >> /home/node/.bashrc
RUN echo 'alias nhc="clear && npx hardhat compile"' >> /home/node/.bashrc
RUN echo 'alias nht="clear && npx hardhat test"' >> /home/node/.bashrc
RUN echo 'alias c="clear"' >> /home/node/.bashrc

# Set working directory
WORKDIR /workspaces

# Switch to node user
