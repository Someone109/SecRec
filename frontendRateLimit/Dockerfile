# Use official Node.js image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy the rest of the application code
COPY . .

# Build the application (if needed)
RUN npm run build || true

# Expose the port your app runs on (change if needed)
EXPOSE 3000

# Start the application (adjust if your entry point is different)
CMD ["node", "dist/index.js"]