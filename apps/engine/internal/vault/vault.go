// Package vault opens what the API sealed to the engine's public key
// (libsodium crypto_box_seal ≡ nacl/box anonymous boxes) and seals session tokens.
package vault

import (
	"crypto/rand"
	"errors"
	"fmt"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/nacl/box"
)

var (
	ErrKeyVersion = errors.New("sealed with a different key version")
	ErrOpen       = errors.New("cannot open sealed box")
)

type Vault struct {
	public  [32]byte
	private [32]byte
	version int32
}

func New(private *[32]byte, version int32) (*Vault, error) {
	pub, err := curve25519.X25519(private[:], curve25519.Basepoint)
	if err != nil {
		return nil, fmt.Errorf("derive public key: %w", err)
	}
	v := &Vault{private: *private, version: version}
	copy(v.public[:], pub)
	return v, nil
}

func (v *Vault) Version() int32 { return v.version }

func (v *Vault) Open(sealed []byte, version int32) ([]byte, error) {
	if version != v.version {
		return nil, fmt.Errorf("%w: have %d, blob %d", ErrKeyVersion, v.version, version)
	}
	out, ok := box.OpenAnonymous(nil, sealed, &v.public, &v.private)
	if !ok {
		return nil, ErrOpen
	}
	return out, nil
}

func (v *Vault) Seal(msg []byte) ([]byte, error) {
	return box.SealAnonymous(nil, msg, &v.public, rand.Reader)
}
