# Use a lightweight official Node.js runtime as a base image
FROM node:18-slim

# Set the working directory in the container
WORKDIR /app

# Install Git (already in your Dockerfile)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install Python, pip, ffmpeg, and yt-dlp ---
# These commands will execute within the /app working directory
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Use --break-system-packages to bypass externally-managed-environment error
RUN pip3 install yt-dlp --break-system-packages

# Clone your Tube Search add-on repository into the current directory
# REPLACE THIS URL with the URL of your PUBLIC Tube Search GitHub repository
RUN git clone https://github.com/FastZet/Tube-Search.git .

# Install application dependencies for the cloned project
RUN npm install --omit=dev

# Set the port environment variable. Hugging Face Spaces typically use 7860.
ENV PORT=7860

# Expose the port on which your application will listen
EXPOSE 7860

# Define the command to run your app
CMD ["npm", "start"]
