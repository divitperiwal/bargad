package mstock

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"bargad/engine/internal/broker"
)

type bookOrder struct {
	OrderID        string        `json:"order_id"`
	Status         string        `json:"status"`
	FilledQuantity broker.Number `json:"filled_quantity"`
	AveragePrice   broker.Number `json:"average_price"`
	StatusMessage  string        `json:"status_message"`
	Tag            flexTag       `json:"tag"`
}

// flexTag reads a tag sent as "x", ["x"], [] or null; the docs show all of them.
type flexTag string

func (t *flexTag) UnmarshalJSON(b []byte) error {
	var s string
	if json.Unmarshal(b, &s) == nil {
		*t = flexTag(s)
		return nil
	}
	var list []string
	if json.Unmarshal(b, &list) == nil && len(list) > 0 {
		*t = flexTag(list[0])
		return nil
	}
	*t = ""
	return nil
}

func (c *Client) PlaceOrder(ctx context.Context, s broker.Session, o broker.OrderRequest) (broker.OrderStatus, error) {
	form := url.Values{
		"tradingsymbol":    {o.Instrument.BrokerID}, // mStock's own symbol, e.g. INFY-EQ
		"exchange":         {o.Instrument.Exchange},
		"transaction_type": {strings.ToUpper(string(o.Side))},
		"order_type":       {"LIMIT"},
		"product":          {"CNC"},
		"validity":         {"DAY"},
		"quantity":         {strconv.FormatInt(o.Quantity, 10)},
		"price":            {strconv.FormatFloat(broker.Rupees(o.LimitPaise), 'f', 2, 64)},
		"tag":              {o.Tag},
	}
	var raw json.RawMessage
	if err := c.do(ctx, s, http.MethodPost, "/orders/regular", form, &raw); err != nil {
		return broker.OrderStatus{}, err
	}
	id, err := orderID(raw)
	if err != nil {
		return broker.OrderStatus{}, err
	}
	// mStock confirms only the id; the reconciler reads fills and rejections.
	return broker.OrderStatus{BrokerOrderID: id, State: broker.StateOpen}, nil
}

func (c *Client) CancelOrder(ctx context.Context, s broker.Session, brokerOrderID string) error {
	return c.do(ctx, s, http.MethodDelete, "/orders/regular/"+url.PathEscape(brokerOrderID), nil, nil)
}

func (c *Client) GetOrder(ctx context.Context, s broker.Session, brokerOrderID string) (broker.OrderStatus, error) {
	return c.findIn(ctx, s, func(o bookOrder) bool { return o.OrderID == brokerOrderID })
}

func (c *Client) FindOrder(ctx context.Context, s broker.Session, tag string) (broker.OrderStatus, error) {
	return c.findIn(ctx, s, func(o bookOrder) bool { return string(o.Tag) == tag })
}

func (c *Client) findIn(ctx context.Context, s broker.Session, match func(bookOrder) bool) (broker.OrderStatus, error) {
	var book []bookOrder
	if err := c.do(ctx, s, http.MethodGet, "/orders", nil, &book); err != nil {
		return broker.OrderStatus{}, err
	}
	for _, o := range book {
		if match(o) {
			filled := o.FilledQuantity.Int()
			return broker.OrderStatus{
				BrokerOrderID: o.OrderID,
				State:         mapState(o.Status, filled),
				FilledQty:     filled,
				AvgFillPaise:  broker.Paise(o.AveragePrice.Float()),
				RejectReason:  o.StatusMessage,
			}, nil
		}
	}
	return broker.OrderStatus{}, broker.ErrOrderNotFound
}

// orderID reads {"order_id"} or [{"order_id"}]; mStock's docs show both.
func orderID(raw json.RawMessage) (string, error) {
	var one struct {
		OrderID string `json:"order_id"`
	}
	if len(raw) > 0 && raw[0] == '[' {
		var list []struct {
			OrderID string `json:"order_id"`
		}
		if err := json.Unmarshal(raw, &list); err != nil || len(list) == 0 {
			return "", errors.New("mstock: no order id in reply")
		}
		return list[0].OrderID, nil
	}
	if err := json.Unmarshal(raw, &one); err != nil || one.OrderID == "" {
		return "", errors.New("mstock: no order id in reply")
	}
	return one.OrderID, nil
}

func mapState(status string, filled int64) broker.State {
	// The docs show "Pending", "Triggered" and "Rejected" but no full list.
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "COMPLETE", "TRADED", "EXECUTED":
		return broker.StateFilled
	case "REJECTED":
		return broker.StateRejected
	case "CANCELLED", "CANCELED", "EXPIRED":
		return broker.StateCancelled // FilledQty still records any part fill
	default:
		if filled > 0 {
			return broker.StatePartial
		}
		return broker.StateOpen
	}
}
