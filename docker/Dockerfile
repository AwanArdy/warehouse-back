FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Instalasi TeX Live XeTeX + paket pendukung dokumen persuratan (qrcode, tabularx, fancyhdr, longtable)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fontconfig \
    texlive-xetex \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    && fc-cache -fv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY templates ./templates
COPY migrations ./migrations

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
