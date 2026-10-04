package broker

import "fmt"

// Registry finds an adapter by the name stored in broker_accounts.broker.
type Registry struct {
	byName map[string]Broker
}

func NewRegistry(brokers ...Broker) *Registry {
	r := &Registry{byName: make(map[string]Broker, len(brokers))}
	for _, b := range brokers {
		r.byName[b.Name()] = b
	}
	return r
}

func (r *Registry) Get(name string) (Broker, error) {
	b, ok := r.byName[name]
	if !ok {
		return nil, fmt.Errorf("no adapter for broker %q", name)
	}
	return b, nil
}
