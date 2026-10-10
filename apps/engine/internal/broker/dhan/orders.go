package dhan

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"bargad/engine/internal/broker"
)

type placeRequest struct {
	DhanClientID    string  `json:"dhanClientId"`
	CorrelationID   string  `json:"correlationId"`
	TransactionType string  `json:"transactionType"`
	ExchangeSegment string  `json:"exchangeSegment"`
	ProductType     string  `json:"productType"`
	OrderType       string  `json:"orderType"`
	Validity        string  `json:"validity"`
	SecurityID      string  `json:"securityId"`
	Quantity        int64   `json:"quantity"`
	Price           float64 `json:"price"`
}

type orderResponse struct {
	OrderID            string        `json:"orderId"`
	OrderStatus        string        `json:"orderStatus"`
	FilledQty          broker.Number `json:"filledQty"`
	AverageTradedPrice broker.Number `json:"averageTradedPrice"`
	OmsErrorDesc       string        `json:"omsErrorDescription"`
}

func (c *Client) PlaceOrder(ctx context.Context, s broker.Session, o broker.OrderRequest) (broker.OrderStatus, error) {
	body := placeRequest{
		DhanClientID:    s.ClientID,
		CorrelationID:   correlationID(o.Tag),
		TransactionType: map[broker.Side]string{broker.Buy: "BUY", broker.Sell: "SELL"}[o.Side],
		ExchangeSegment: segment(o.Instrument.Exchange),
		ProductType:     "CNC",
		OrderType:       "LIMIT",
		Validity:        "DAY",
		SecurityID:      o.Instrument.BrokerID,
		Quantity:        o.Quantity,
		Price:           broker.Rupees(o.LimitPaise),
	}
	var out orderResponse
	if err := c.do(ctx, s, http.MethodPost, c.baseURL+"/orders", body, &out); err != nil {
		return broker.OrderStatus{}, err
	}
	st := toStatus(out)
	if st.State == broker.StateRejected {
		return st, &broker.RejectedError{Reason: st.RejectReason}
	}
	return st, nil
}

func (c *Client) CancelOrder(ctx context.Context, s broker.Session, brokerOrderID string) error {
	return c.do(ctx, s, http.MethodDelete, c.baseURL+"/orders/"+url.PathEscape(brokerOrderID), nil, nil)
}

func (c *Client) GetOrder(ctx context.Context, s broker.Session, brokerOrderID string) (broker.OrderStatus, error) {
	return c.lookup(ctx, s, c.baseURL+"/orders/"+url.PathEscape(brokerOrderID))
}

func (c *Client) FindOrder(ctx context.Context, s broker.Session, tag string) (broker.OrderStatus, error) {
	return c.lookup(ctx, s, c.baseURL+"/orders/external/"+url.PathEscape(correlationID(tag)))
}

func (c *Client) lookup(ctx context.Context, s broker.Session, u string) (broker.OrderStatus, error) {
	var raw json.RawMessage
	if err := c.do(ctx, s, http.MethodGet, u, nil, &raw); err != nil {
		return broker.OrderStatus{}, err
	}
	out, err := decodeOne(raw)
	if err != nil {
		return broker.OrderStatus{}, err
	}
	return toStatus(out), nil
}

// decodeOne accepts a single order or a list of them; Dhan returns both shapes.
func decodeOne(raw json.RawMessage) (orderResponse, error) {
	if len(raw) > 0 && raw[0] == '[' {
		var list []orderResponse
		if err := json.Unmarshal(raw, &list); err != nil {
			return orderResponse{}, err
		}
		if len(list) == 0 {
			return orderResponse{}, broker.ErrOrderNotFound
		}
		return list[0], nil
	}
	var one orderResponse
	if err := json.Unmarshal(raw, &one); err != nil {
		return orderResponse{}, err
	}
	if one.OrderID == "" {
		return orderResponse{}, errors.New("dhan: order without id")
	}
	return one, nil
}

func toStatus(o orderResponse) broker.OrderStatus {
	return broker.OrderStatus{
		BrokerOrderID: o.OrderID,
		State:         mapState(o.OrderStatus, o.FilledQty.Int()),
		FilledQty:     o.FilledQty.Int(),
		AvgFillPaise:  broker.Paise(o.AverageTradedPrice.Float()),
		RejectReason:  o.OmsErrorDesc,
	}
}

func mapState(s string, filled int64) broker.State {
	switch s {
	case "TRADED":
		return broker.StateFilled
	case "PART_TRADED":
		return broker.StatePartial
	case "REJECTED":
		return broker.StateRejected
	case "CANCELLED", "EXPIRED":
		return broker.StateCancelled
	case "TRANSIT", "PENDING":
		if filled > 0 {
			return broker.StatePartial
		}
		return broker.StateOpen
	default:
		return broker.StateOpen
	}
}

func segment(exchange string) string {
	if exchange == "BSE" {
		return "BSE_EQ"
	}
	return "NSE_EQ"
}

// securityID turns Dhan's numeric security id into the number its market-data API expects.
func securityID(id string) (int64, error) {
	return strconv.ParseInt(id, 10, 64)
}
