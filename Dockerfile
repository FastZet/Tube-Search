# Use a lightweight official Node.js runtime as a base image
FROM node:18-slim

# Set the working directory in the container
WORKDIR /app

# Install Git, as it's not present in node:18-slim by default, but needed for git clone
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Clone your Tube Search add-on repository into the current directory
# REPLACE THIS URL with the URL of your PUBLIC Tube Search GitHub repository
RUN git clone https://github.com/your-username/your-tube-search-repo.git .

# Install application dependencies for the cloned project
# The --omit=dev flag ensures dev dependencies are not installed in production
RUN npm install --omit=dev

# Set the port environment variable. Hugging Face Spaces typically use 7860.
ENV PORT=7860

# Expose the port on which your application will listen
EXPOSE 7860

# Define the command to run your app
CMD ["npm", "start"]
