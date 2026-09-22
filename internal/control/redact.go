package control

import (
	"net/url"
	"regexp"
	"strings"
)

// safeControlUrl / redactControlText ported from
// desktop/src/main/browser-control-native.ts. These are the credential
// boundary: no URL userinfo, query, hash, or long path segment and no
// credential-shaped text may reach a product or an observation artifact.

var longPathSegment = regexp.MustCompile(`[A-Za-z0-9_\-\.]{48,}`)

// SafeControlURL returns origin + pathname with 48+ char segments replaced
// by "[redacted]". Userinfo, query, and fragment are dropped entirely.
func SafeControlURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	u.User = nil
	u.RawQuery = ""
	u.ForceQuery = false
	u.Fragment = ""
	u.RawFragment = ""
	// Only http(s) pages are controllable; anything else collapses to origin.
	if u.Scheme != "http" && u.Scheme != "https" {
		return u.Scheme + "://" + u.Host
	}
	path := longPathSegment.ReplaceAllString(u.EscapedPath(), "[redacted]")
	// Build the string manually: url.URL.String() would percent-encode the
	// literal [redacted] markers.
	return u.Scheme + "://" + u.Host + path
}

var (
	reBearer    = regexp.MustCompile(`(?i)bearer\s+[A-Za-z0-9_\-\.~+/]+=*`)
	reAPIKey    = regexp.MustCompile(`(?i)\b(sk|pk|api|key|token|secret|password|passwd|otp|totp|code)[_-]?[A-Za-z0-9]*\s*[:=]\s*["']?[A-Za-z0-9_\-\.~+/]{6,}["']?`)
	reJWT       = regexp.MustCompile(`eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`)
	reDigits    = regexp.MustCompile(`\b\d{6,19}\b`)
	reBasicAuth = regexp.MustCompile(`(?i)authorization\s*:\s*\S+`)
)

// RedactControlText removes credential-shaped strings from observation text.
func RedactControlText(s string) string {
	s = reBearer.ReplaceAllString(s, "[redacted]")
	s = reJWT.ReplaceAllString(s, "[redacted]")
	s = reBasicAuth.ReplaceAllStringFunc(s, func(m string) string {
		i := strings.Index(m, ":")
		return m[:i+1] + " [redacted]"
	})
	s = reAPIKey.ReplaceAllString(s, "[redacted]")
	s = reDigits.ReplaceAllString(s, "[redacted]")
	return s
}

// SensitiveFieldRe mirrors the domControl sensitive-field regex: anything that
// looks like a credential field is never filled with a captured value nor
// echoed into observations.
var SensitiveFieldRe = regexp.MustCompile(`(?i)(password|passwd|pwd|otp|totp|2fa|mfa|cvv|cvc|cc[-_ ]?num|card[-_ ]?num|secret|token|ssn|credential)`)
