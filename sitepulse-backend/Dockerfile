FROM python:3.11-slim

# No system packages needed: the DZI/pyvips tile pipeline was removed (the
# frontend renders PDFs client-side via pdf.js) — libvips-dev was dead weight
# and attack surface. PyMuPDF ships its own wheels.

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as a non-root user (defense-in-depth). Nothing writes to the filesystem
# at runtime (AGENTS §7: no debug file writes; PyMuPDF works in memory) and
# uvicorn binds a high port, so no root capability is needed.
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
