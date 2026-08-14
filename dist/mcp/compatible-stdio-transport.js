import process from 'node:process';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { withMcpWrite } from './stdio-context.js';
function deserializeMessage(raw) {
    return JSONRPCMessageSchema.parse(JSON.parse(raw));
}
function serializeNewlineMessage(message) {
    return `${JSON.stringify(message)}\n`;
}
function serializeContentLengthMessage(message) {
    const body = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}
function findHeaderEnd(buffer) {
    const crlfEnd = buffer.indexOf('\r\n\r\n');
    if (crlfEnd !== -1) {
        return { index: crlfEnd, separatorLength: 4 };
    }
    const lfEnd = buffer.indexOf('\n\n');
    if (lfEnd !== -1) {
        return { index: lfEnd, separatorLength: 2 };
    }
    return null;
}
function looksLikeContentLength(buffer) {
    if (buffer.length < 14) {
        return false;
    }
    const probe = buffer.toString('utf8', 0, Math.min(buffer.length, 32));
    return /^content-length\s*:/i.test(probe);
}
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10 MB — generous for JSON-RPC
export class CompatibleStdioServerTransport {
    _stdin;
    _stdout;
    _readBuffer;
    _started = false;
    _closed = false;
    _framing = null;
    onmessage;
    onerror;
    onclose;
    /** Stable bound reference so `on`/`off` always use the same function. */
    _boundClose = this.close.bind(this);
    constructor(_stdin = process.stdin, _stdout = process.stdout) {
        this._stdin = _stdin;
        this._stdout = _stdout;
    }
    _ondata = (chunk) => {
        this._readBuffer = this._readBuffer ? Buffer.concat([this._readBuffer, chunk]) : chunk;
        if (this._readBuffer.length > MAX_BUFFER_SIZE) {
            this.onerror?.(new Error(`Read buffer exceeded maximum size (${MAX_BUFFER_SIZE} bytes)`));
            this.discardBufferedInput();
            return;
        }
        this.processReadBuffer();
    };
    _onerror = (error) => {
        this.onerror?.(error);
    };
    async start() {
        if (this._started) {
            throw new Error('CompatibleStdioServerTransport already started!');
        }
        if (this._closed) {
            throw new Error('CompatibleStdioServerTransport has been permanently closed');
        }
        // If stdin is already closed (parent died before we registered listeners),
        // the 'end'/'close' event was already emitted and will never fire again.
        // Close the transport immediately to avoid orphaned processes.
        if (this._stdin.readableEnded ||
            this._stdin.destroyed) {
            this._started = true;
            await this.close();
            return;
        }
        this._started = true;
        this._stdin.on('data', this._ondata);
        this._stdin.on('error', this._onerror);
        this._stdin.on('end', this._boundClose);
        this._stdin.on('close', this._boundClose);
    }
    detectFraming() {
        if (!this._readBuffer || this._readBuffer.length === 0) {
            return null;
        }
        const firstByte = this._readBuffer[0];
        if (firstByte === 0x7b || firstByte === 0x5b) {
            return 'newline';
        }
        if (looksLikeContentLength(this._readBuffer)) {
            return 'content-length';
        }
        return null;
    }
    discardBufferedInput() {
        this._readBuffer = undefined;
        this._framing = null;
    }
    readContentLengthMessage() {
        if (!this._readBuffer) {
            return null;
        }
        const header = findHeaderEnd(this._readBuffer);
        if (header === null) {
            return null;
        }
        const headerText = this._readBuffer
            .toString('utf8', 0, header.index)
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
        const match = headerText.match(/(?:^|\n)content-length\s*:\s*(\d+)/i);
        if (!match) {
            this.discardBufferedInput();
            throw new Error('Missing Content-Length header from MCP client');
        }
        const contentLength = Number.parseInt(match[1], 10);
        if (!Number.isFinite(contentLength) || contentLength < 0) {
            this.discardBufferedInput();
            throw new Error('Invalid Content-Length header from MCP client');
        }
        if (contentLength > MAX_BUFFER_SIZE) {
            this.discardBufferedInput();
            throw new Error(`Content-Length ${contentLength} exceeds maximum allowed size (${MAX_BUFFER_SIZE} bytes)`);
        }
        const bodyStart = header.index + header.separatorLength;
        const bodyEnd = bodyStart + contentLength;
        if (this._readBuffer.length < bodyEnd) {
            return null;
        }
        const body = this._readBuffer.toString('utf8', bodyStart, bodyEnd);
        this._readBuffer = this._readBuffer.subarray(bodyEnd);
        return deserializeMessage(body);
    }
    readNewlineMessage() {
        if (!this._readBuffer) {
            return null;
        }
        while (true) {
            const newlineIndex = this._readBuffer.indexOf('\n');
            if (newlineIndex === -1) {
                return null;
            }
            const line = this._readBuffer.toString('utf8', 0, newlineIndex).replace(/\r$/, '');
            this._readBuffer = this._readBuffer.subarray(newlineIndex + 1);
            if (line.trim().length === 0) {
                continue;
            }
            return deserializeMessage(line);
        }
    }
    readMessage() {
        if (!this._readBuffer || this._readBuffer.length === 0) {
            return null;
        }
        if (this._framing === null) {
            this._framing = this.detectFraming();
            if (this._framing === null) {
                return null;
            }
        }
        return this._framing === 'content-length'
            ? this.readContentLengthMessage()
            : this.readNewlineMessage();
    }
    processReadBuffer() {
        while (true) {
            try {
                const message = this.readMessage();
                if (message === null) {
                    break;
                }
                this.onmessage?.(message);
            }
            catch (error) {
                this.onerror?.(error);
                break;
            }
        }
    }
    async close() {
        if (this._closed)
            return;
        this._closed = true;
        this._stdin.off('data', this._ondata);
        this._stdin.off('error', this._onerror);
        this._stdin.off('end', this._boundClose);
        this._stdin.off('close', this._boundClose);
        const remainingDataListeners = this._stdin.listenerCount('data');
        if (remainingDataListeners === 0) {
            this._stdin.pause();
        }
        this._started = false;
        this._readBuffer = undefined;
        this.onclose?.();
    }
    send(message, _options) {
        return new Promise((resolve, reject) => {
            if (!this._started) {
                reject(new Error('Transport is closed'));
                return;
            }
            const payload = this._framing === 'newline'
                ? serializeNewlineMessage(message)
                : serializeContentLengthMessage(message);
            const onError = (error) => {
                this._stdout.removeListener('error', onError);
                reject(error);
            };
            this._stdout.on('error', onError);
            // Tag the write with the MCP transport context so the sentinel
            // (server.ts createStdoutSentinel Proxy) recognizes it as a legitimate
            // JSON-RPC frame and passes it through to the real stdout instead of
            // redirecting to stderr.
            const writeOk = withMcpWrite(() => this._stdout.write(payload));
            if (writeOk) {
                this._stdout.removeListener('error', onError);
                resolve();
            }
            else {
                this._stdout.once('drain', () => {
                    this._stdout.removeListener('error', onError);
                    resolve();
                });
            }
        });
    }
}
