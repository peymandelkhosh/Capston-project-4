# Use the official Node.js 20 Alpine image for a lightweight footprint
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the application code
COPY . .

# Expose port 3000 to the host
EXPOSE 3000

# Set the environment variable to production
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
