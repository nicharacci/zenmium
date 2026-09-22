package relay

import (
	"encoding/binary"
	"fmt"
	"io"
	"unicode/utf8"
)

// Native-messaging wire format, ported from desktop/src/main/native-messaging.ts:
// 4-byte little-endian length prefix, max 1 MiB, payloads MUST be valid UTF-8
// (a decode failure is fatal — the connection is dropped, never resynced).

const MaxMessageSize = 1 << 20 // 1 MiB

// WriteFrame writes one length-prefixed message.
func WriteFrame(w io.Writer, payload []byte) error {
	if len(payload) > MaxMessageSize {
		return fmt.Errorf("message exceeds 1 MiB cap")
	}
	if !utf8.Valid(payload) {
		return fmt.Errorf("message must be UTF-8")
	}
	var hdr [4]byte
	binary.LittleEndian.PutUint32(hdr[:], uint32(len(payload)))
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	_, err := w.Write(payload)
	return err
}

// ReadFrame reads one length-prefixed message. A bad length prefix, a too-big
// payload, or invalid UTF-8 returns an error and the caller must close the
// stream — the v1 decoder is fatal, not resynchronizing.
func ReadFrame(r io.Reader) ([]byte, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	n := binary.LittleEndian.Uint32(hdr[:])
	if n == 0 || n > MaxMessageSize {
		return nil, fmt.Errorf("bad frame length %d", n)
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	if !utf8.Valid(buf) {
		return nil, fmt.Errorf("payload is not valid UTF-8")
	}
	return buf, nil
}
