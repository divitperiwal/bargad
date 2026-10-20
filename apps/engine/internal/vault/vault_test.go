package vault

import (
	"crypto/rand"
	"errors"
	"testing"
)

func newVault(t *testing.T) *Vault {
	t.Helper()
	var key [32]byte
	if _, err := rand.Read(key[:]); err != nil {
		t.Fatal(err)
	}
	v, err := New(&key, 1)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestSealOpenRoundTrip(t *testing.T) {
	v := newVault(t)
	sealed, err := v.Seal([]byte(`{"pin":"1234"}`))
	if err != nil {
		t.Fatal(err)
	}
	got, err := v.Open(sealed, 1)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != `{"pin":"1234"}` {
		t.Errorf("Open = %q", got)
	}
}

func TestOpenRefusesWrongVersion(t *testing.T) {
	v := newVault(t)
	sealed, _ := v.Seal([]byte("x"))
	if _, err := v.Open(sealed, 2); !errors.Is(err, ErrKeyVersion) {
		t.Errorf("err = %v, want ErrKeyVersion", err)
	}
}

func TestOpenRefusesTampering(t *testing.T) {
	v := newVault(t)
	sealed, _ := v.Seal([]byte("secret"))
	sealed[len(sealed)-1] ^= 0xff
	if _, err := v.Open(sealed, 1); !errors.Is(err, ErrOpen) {
		t.Errorf("err = %v, want ErrOpen", err)
	}
}
